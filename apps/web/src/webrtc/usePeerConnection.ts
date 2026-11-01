import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { SOCKET_EVENTS } from '@airbond/shared';
import type { FileTransferProgressPayload, FileMetadata, FileTransferSignal } from '@airbond/shared';
import { ICE_CONFIG } from './iceConfig';
import { classifyConnectionType } from './connectionType';
import { computeFileId } from './fileId';
import { isOpfsSupported } from './opfsSupport';
import {
  closeFile as closeOpfsFile,
  getOpfsFile,
  initFile as initOpfsFile,
  onChunkWritten,
  onWriteError,
  removeOpfsFile,
  writeChunk as writeOpfsChunk,
} from './opfsClient';
import {
  isTransferDbSupported,
  getTransferRecord,
  saveTransferProgress,
  deleteTransferRecord,
  listTransferRecords,
} from './transferDb';

interface TransferSample {
  time: number;
  bytes: number;
}

const SPEED_SAMPLE_WINDOW_MS = 2000;
const UI_UPDATE_THROTTLE_MS = 150;
const CHUNK_SIZE = 64 * 1024;
const BUFFER_HIGH_WATERMARK = 1024 * 1024;
// How long the sender waits for a FILE_ACCEPT resume offset before starting
// to stream - only applies with exactly one peer connected (see broadcastFiles).
// With 2+ peers, different peers could legitimately want different resume
// points and there's no single offset that's correct for everyone, so mesh
// sends always restart from 0 (identical to pre-resume behavior) instead of
// risking a wrong guess.
const RESUME_ACCEPT_WAIT_MS = 150;
// Receiver-side OPFS write backpressure watermarks - "write lag" is bytes
// handed to the worker for writing but not yet confirmed written to disk.
// Hysteresis (engage high, release low) avoids rapidly flapping pause/resume
// when the lag is hovering right around one threshold.
const WRITE_LAG_HIGH_WATERMARK = 4 * 1024 * 1024;
const WRITE_LAG_LOW_WATERMARK = 1 * 1024 * 1024;
const BACKPRESSURE_REPORT_THROTTLE_MS = 500;
// Resume is for catching a dropped connection within the same session, not
// a permanent store - an incomplete transfer nobody ever came back to finish
// still gets swept off disk after this long, matching the rest of the app's
// 2-hour ephemeral ceiling (SETUP.md) instead of lingering forever.
const STALE_TRANSFER_TTL_MS = 2 * 60 * 60 * 1000;

async function sweepStaleTransfers() {
  if (!isTransferDbSupported()) return;
  try {
    const records = await listTransferRecords();
    const cutoff = Date.now() - STALE_TRANSFER_TTL_MS;
    for (const record of records) {
      if (record.updatedAt < cutoff) {
        await removeOpfsFile(record.fileId).catch(() => {});
        await deleteTransferRecord(record.fileId).catch(() => {});
      }
    }
  } catch {
    // IndexedDB unavailable/blocked - nothing to sweep, resume just won't
    // find stale records either way.
  }
}

function computeSpeedBps(samples: TransferSample[]): number {
  if (samples.length < 2) return 0;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const elapsedSeconds = (last.time - first.time) / 1000;
  if (elapsedSeconds <= 0) return 0;
  return (last.bytes - first.bytes) / elapsedSeconds;
}

function pruneOldSamples(samples: TransferSample[], now: number) {
  while (samples.length > 0 && now - samples[0].time > SPEED_SAMPLE_WINDOW_MS) {
    samples.shift();
  }
}

export interface FileTransferMeta {
  name: string;
  size: number;
}

export function usePeerConnection() {
  const socketRef = useRef<Socket | null>(null); //socket referense object to store about socket
  const roomIdRef = useRef<string>('');  // room reference object to store room info : (roomIdRef.current to get value)

  // Multi-peer maps
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());  //store each peers connection recored (for multipeer connection)
  const dataChannelsRef = useRef<Map<string, RTCDataChannel>>(new Map());  //store each peers datachanel recored : (what actually transfers your file data.)
  const candidateQueues = useRef<Map<string, RTCIceCandidateInit[]>>(new Map()); //stores ICE candidates that arrive before the remote SDP description 

  // Incoming transfer buffers - receivedChunksRef is only used as a fallback
  // when OPFS isn't available (Firefox/Safari); when it is, chunks stream
  // straight to disk via the OPFS worker instead of piling up in JS heap.
  const receivedChunksRef = useRef<Uint8Array[]>([]);
  // Object URLs created for a completed download - deliberately NOT revoked
  // on any guessed timer (a fixed delay can never be provably safe: a large
  // enough file or slow enough disk just needs a bit longer than whatever
  // number was picked, and the browser's download manager loses the race
  // silently - it shows "Download failed" while our own UI, which only
  // triggered the click and has no visibility into whether the browser
  // actually finished reading the blob, still says "downloaded"). Revoked
  // only when this hook itself unmounts, by which point every download this
  // session ever triggered has unambiguously either finished or been
  // abandoned by the browser's own page-unload handling - never by us
  // guessing a number.
  const pendingDownloadUrlsRef = useRef<string[]>([]);
  // The File a download reads from is a live view into its backing OPFS
  // storage, not an in-memory snapshot - removing that storage while the
  // browser's download manager is still (asynchronously, unobservably)
  // reading it cancels the download outright ("Download failed" despite our
  // own UI saying "downloaded"). Same fix as pendingDownloadUrlsRef: defer
  // the actual deletion to this hook's unmount instead of guessing a delay.
  const pendingOpfsCleanupRef = useRef<string[]>([]);
  const fileMetadataRef = useRef<{ fileId: string; name: string; size: number; mimeType: string } | null>(null);
  const receivedTotalRef = useRef<number>(0);
  const receiveSamplesRef = useRef<TransferSample[]>([]);
  const lastReceiveUiUpdateRef = useRef<number>(0);
  const sentSamplesRef = useRef<TransferSample[]>([]);
  const lastSendUiUpdateRef = useRef<number>(0);
  // FILE_ACCEPT responses land here, keyed by fileId - broadcastFiles reads
  // this (solo-peer only) to decide where to start streaming from.
  const resumeOffsetsRef = useRef<Map<string, number>>(new Map());

  // Sender-side pause: plain refs (not just state) so sendOneFile's chunk
  // loop can read the latest value without re-subscribing to it as a
  // dependency. Only one file sends at a time (broadcastFiles awaits each
  // sendOneFile before starting the next), so a single flag + the fileId
  // currently in flight is enough - no per-file map needed.
  //
  // Two independent sources can hold the send loop paused: the user's own
  // Pause button, and any connected peer currently signaling write
  // backpressure (its disk can't keep up). Tracked separately so a manual
  // Resume click can't override a peer that's still struggling, and so a
  // peer catching up can't silently cancel a pause the user asked for.
  const isUserPausedRef = useRef(false);
  const backpressurePeersRef = useRef<Set<string>>(new Set());
  const activeSendFileIdRef = useRef<string | null>(null);
  // The true current send state, updated on EVERY chunk (not throttled) -
  // see flushSendProgressNow. The UI's own setSendProgress/setSendSpeedBps
  // calls inside the chunk loop stay throttled for render/network economy
  // during normal sending, but whatever blocks sending (pause, backpressure)
  // needs the untouched-by-throttle value the instant it blocks, or the
  // displayed "X / Y sent" freezes at a stale, too-low number while the
  // receiver (which has no such throttle on what it's actually received)
  // correctly shows more bytes already in - looking like a mismatch/bug.
  const lastSendProgressRef = useRef<{
    fileName: string;
    fileSize: number;
    bytesTransferred: number;
    queueIndex?: number;
    queueTotal?: number;
  } | null>(null);

  function isSendBlocked(): boolean {
    return isUserPausedRef.current || backpressurePeersRef.current.size > 0;
  }

  // Forces the UI (and the dashboard ping) to the true up-to-the-moment
  // send state right when something blocks or unblocks sending, instead of
  // waiting for the chunk loop's own throttled tick (which has stopped
  // ticking in the first place, since it's blocked).
  function flushSendProgressNow(paused: boolean) {
    const last = lastSendProgressRef.current;
    if (!last) return;
    setSendProgress(last.fileSize > 0 ? last.bytesTransferred / last.fileSize : 0);
    setSendSpeedBps(paused ? 0 : computeSpeedBps(sentSamplesRef.current));
    reportTransferProgress(
      'send',
      last.fileName,
      last.fileSize,
      last.bytesTransferred,
      last.queueIndex,
      last.queueTotal,
      paused,
    );
  }

  // Wakes the send loop the instant something that could unblock it happens
  // (Resume click, a peer's backpressure clearing, a backpressured peer
  // disconnecting) instead of it finding out on its next poll. Plain
  // in-memory resolver callbacks - nothing persisted, nothing to clean up if
  // no one happens to be waiting when this fires.
  const unblockWaitersRef = useRef<Array<() => void>>([]);

  function waitForUnblock(): Promise<void> {
    return new Promise((resolve) => {
      unblockWaitersRef.current.push(resolve);
    });
  }

  function notifyMaybeUnblocked() {
    const waiters = unblockWaitersRef.current;
    unblockWaitersRef.current = [];
    waiters.forEach((resolve) => resolve());
  }

  // Component state
  const [roomId, setRoomId] = useState<string>('');
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [isSocketConnected, setIsSocketConnected] = useState<boolean>(false);
  const [receivedBytes, setReceivedBytes] = useState<number>(0);
  const [receiveFileMeta, setReceiveFileMeta] = useState<FileTransferMeta | null>(null);
  const [receiveSpeedBps, setReceiveSpeedBps] = useState<number>(0);
  const [sendQueueTotal, setSendQueueTotal] = useState<number>(0);
  const [sendQueueIndex, setSendQueueIndex] = useState<number>(0);
  const [sendFileMeta, setSendFileMeta] = useState<FileTransferMeta | null>(null);
  const [sendProgress, setSendProgress] = useState<number>(0);
  const [sendSpeedBps, setSendSpeedBps] = useState<number>(0);
  const [isSendPaused, setIsSendPaused] = useState<boolean>(false);
  const [isSendBackpressured, setIsSendBackpressured] = useState<boolean>(false);
  const [isReceivePaused, setIsReceivePaused] = useState<boolean>(false);
  const [isReceiveDiskSlow, setIsReceiveDiskSlow] = useState<boolean>(false);
  const [receiveWriteLagBytes, setReceiveWriteLagBytes] = useState<number>(0);
  // Set when a receive genuinely fails (disk write error, or finalizing the
  // download itself throws) - distinct from a normal in-progress transfer,
  // so the UI can say so instead of silently never reaching "downloaded".
  const [receiveError, setReceiveError] = useState<string | null>(null);

  //ready-state tracking ref
  const remoteDescriptionSet = useRef<Map<string, boolean>>(new Map());
  //sync room id
  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);


  // Helper to sync open data channels to React state (checks which DataChannels are actually open and updates React UI)
  const updateConnectedPeerList = useCallback(() => {
    const activeIds: string[] = [];
    dataChannelsRef.current.forEach((dc, peerId) => {
      if (dc.readyState === 'open') {
        activeIds.push(peerId);
      }
    });
    setConnectedPeers([...activeIds]);
  }, []);



  function createPeerConnection(peerId: string): RTCPeerConnection {
    if (peersRef.current.has(peerId)) {
      peersRef.current.get(peerId)?.close();
    }

    const pc = new RTCPeerConnection(ICE_CONFIG);
    peersRef.current.set(peerId, pc);
    candidateQueues.current.set(peerId, []);
    remoteDescriptionSet.current.set(peerId, false);

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit(SOCKET_EVENTS.ICE_CANDIDATE, {
          targetPeerId: peerId,
          candidate: event.candidate,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`Peer [${peerId}] State:`, pc.connectionState);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        closePeer(peerId);
      }
    };

    return pc;
  }

  function bindDataChannel(dc: RTCDataChannel, peerId: string) {
    dc.binaryType = 'arraybuffer';

    dc.onopen = () => {
      console.log(`DataChannel OPEN with peer: ${peerId}`);
      updateConnectedPeerList();

      // Metadata-only: classify how this connection actually got established
      // (direct P2P vs relayed through TURN) for the live stats dashboard.
      // The server has no visibility into this on its own - it only sees
      // whatever we report here.
      const pc = peersRef.current.get(peerId);
      if (pc) {
        void classifyConnectionType(pc).then((connectionType) => {
          if (!socketRef.current || !roomIdRef.current) return;
          socketRef.current.emit(SOCKET_EVENTS.CONNECTION_INFO, {
            roomId: roomIdRef.current,
            connectionType,
          });
        });
      }
    };

    dc.onclose = () => {
      console.log(`DataChannel CLOSED with peer: ${peerId}`);
      dataChannelsRef.current.delete(peerId);
      // A receive in progress on this exact channel just lost its sender -
      // otherwise this silently leaves the progress bar frozen forever with
      // no indication anything went wrong, and leaks the OPFS listeners
      // registered for a transfer that's never going to finish.
      if (activeFileId) {
        onChunkWritten(activeFileId, null);
        onWriteError(activeFileId, null);
        if (fileMetadataRef.current?.fileId === activeFileId) {
          setReceiveError('Connection to the sender was lost before the transfer finished.');
        }
        activeFileId = null;
      }
      receiveReady = false;
      pendingEarlyChunks = [];
      updateConnectedPeerList();
    };

    // Scoped to this peer's channel (not a hook-level ref) so OPFS/IndexedDB
    // writes are always routed against the file actually in flight on THIS
    // connection, even though the UI-facing singular refs below stay shared
    // across peers exactly as before (last-active-transfer-wins, same as
    // pre-existing behavior for a mesh of senders).
    let activeFileId: string | null = null;
    let useOpfsForActive = false;
    // Write-backpressure bookkeeping (OPFS path only) - see reportWriteLag.
    let confirmedWrittenBytes = 0;
    let writeBackpressureEngaged = false;
    let lastBackpressureReportAt = 0;
    let lastLagUiUpdateAt = 0;
    // FILE_OFFER processing awaits an IndexedDB lookup (and, in a mesh of
    // 2+ peers, the sender doesn't wait at all before streaming - see
    // RESUME_ACCEPT_WAIT_MS) - a binary chunk can genuinely arrive before
    // that await resolves and all the per-transfer state below is settled.
    // Queueing instead of processing-or-dropping means a slow IndexedDB
    // open can never lose or misroute the first chunk(s) of a transfer.
    let receiveReady = false;
    let pendingEarlyChunks: ArrayBuffer[] = [];

    // Compares bytes received so far against bytes actually confirmed written
    // to OPFS and, if the gap has crossed a watermark, flips this peer's
    // backpressure state - telling the sender over `dc` to hold off (or go
    // ahead again), and pinging the server for the live dashboard.
    //
    // Called from two places: the throttled receive-progress block below
    // (as bytes keep arriving), AND directly from the onChunkWritten
    // listener registered at FILE_OFFER time (as writes keep draining).
    // Both call sites matter - once backpressure engages, the sender stops
    // sending, so no new chunks ever arrive to re-trigger this from the
    // first call site. Without the second one, a receiver that asked the
    // sender to pause would have no way to ever tell it to resume again -
    // the release would be waiting on exactly the chunks it just stopped.
    // The UI number itself is still throttled (lastLagUiUpdateAt) since
    // write confirmations can arrive in a fast burst while draining a
    // backlog - the engage/release decision and control message are not.
    function reportWriteLag() {
      if (!activeFileId || !useOpfsForActive) return;
      const lagBytes = Math.max(0, receivedTotalRef.current - confirmedWrittenBytes);

      let transitioned = false;
      if (!writeBackpressureEngaged && lagBytes > WRITE_LAG_HIGH_WATERMARK) {
        writeBackpressureEngaged = true;
        transitioned = true;
      } else if (writeBackpressureEngaged && lagBytes < WRITE_LAG_LOW_WATERMARK) {
        writeBackpressureEngaged = false;
        transitioned = true;
      }

      const now = Date.now();
      if (transitioned || now - lastLagUiUpdateAt > UI_UPDATE_THROTTLE_MS) {
        lastLagUiUpdateAt = now;
        setReceiveWriteLagBytes(lagBytes);
      }

      if (transitioned) {
        setIsReceiveDiskSlow(writeBackpressureEngaged);
        const msg: FileTransferSignal = { type: 'WRITE_BACKPRESSURE', fileId: activeFileId, engaged: writeBackpressureEngaged };
        dc.send(JSON.stringify(msg));
      }

      if ((transitioned || now - lastBackpressureReportAt > BACKPRESSURE_REPORT_THROTTLE_MS) && socketRef.current && roomIdRef.current && fileMetadataRef.current) {
        lastBackpressureReportAt = now;
        socketRef.current.emit(SOCKET_EVENTS.FILE_TRANSFER_BACKPRESSURE, {
          roomId: roomIdRef.current,
          fileName: fileMetadataRef.current.name,
          writeLagBytes: lagBytes,
          engaged: writeBackpressureEngaged,
        });
      }
    }

    const finishReceive = async (fileId: string) => {
      const meta = fileMetadataRef.current;
      if (!meta || meta.fileId !== fileId) return;

      try {
        let file: File;
        if (useOpfsForActive) {
          await closeOpfsFile(fileId);
          file = await getOpfsFile(fileId, meta.name, meta.mimeType || 'application/octet-stream');
        } else {
          // Blob/File constructors accept Uint8Array (and other
          // ArrayBufferView/BufferSource) parts directly - no need to copy
          // each chunk into a brand-new ArrayBuffer first. That copy used to
          // transiently double peak memory right at the one moment (large
          // file, no OPFS - Safari/Firefox) where memory is already the
          // binding constraint for this fallback path.
          file = new File(receivedChunksRef.current as BlobPart[], meta.name, { type: meta.mimeType || undefined });
        }

        const url = URL.createObjectURL(file);
        pendingDownloadUrlsRef.current.push(url);
        const a = document.createElement('a');
        a.href = url;
        a.download = meta.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Not revoked here - see pendingDownloadUrlsRef's declaration. No
        // fixed delay is actually safe to guess: the browser's download
        // manager reading this blob is fully async and has no completion
        // event we can observe, so any timeout we pick can still lose the
        // race for a large enough file - revoking here is exactly what
        // produced a "download failed" browser popup despite our own UI
        // (which has no way to know better) showing "downloaded".

        if (useOpfsForActive) {
          // Not removed here - see pendingOpfsCleanupRef's declaration.
          // Deleting this file's OPFS storage now (while the browser may
          // still be reading the File object the download above handed it)
          // is exactly what was silently canceling downloads.
          pendingOpfsCleanupRef.current.push(fileId);
        }
        if (isTransferDbSupported()) {
          await deleteTransferRecord(fileId).catch(() => {});
        }

        // closeOpfsFile() above already awaited the worker flushing every
        // queued write, so writes are caught up by construction - release any
        // backpressure this peer was still asserting instead of leaving the
        // sender thinking it should hold off on a file that's already done.
        if (writeBackpressureEngaged) {
          writeBackpressureEngaged = false;
          dc.send(JSON.stringify({ type: 'WRITE_BACKPRESSURE', fileId, engaged: false } satisfies FileTransferSignal));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setReceiveError(`Couldn't finish saving the file: ${message}`);
      }

      onChunkWritten(fileId, null);
      onWriteError(fileId, null);
      confirmedWrittenBytes = 0;

      receivedChunksRef.current = [];
      setReceivedBytes(receivedTotalRef.current);
      setReceiveSpeedBps(0);
      setIsReceivePaused(false);
      setIsReceiveDiskSlow(false);
      setReceiveWriteLagBytes(0);
    };

    dc.onmessage = (event) => {
      if (typeof event.data === 'string') {
        void (async () => {
          try {
            const msg = JSON.parse(event.data) as FileTransferSignal;

            if (msg.type === 'FILE_OFFER') {
              const metadata: FileMetadata = msg.metadata;

              // Hold any chunk that arrives before setup below fully
              // completes (see processIncomingChunk/pendingEarlyChunks) -
              // flushed once everything this offer sets up is settled.
              receiveReady = false;
              pendingEarlyChunks = [];

              activeFileId = metadata.fileId;
              useOpfsForActive = isOpfsSupported();

              const existing =
                useOpfsForActive && isTransferDbSupported()
                  ? await getTransferRecord(metadata.fileId).catch(() => undefined)
                  : undefined;
              const startOffset = existing && !existing.isCompleted ? existing.receivedBytes : 0;

              confirmedWrittenBytes = startOffset;
              writeBackpressureEngaged = false;
              lastBackpressureReportAt = 0;

              fileMetadataRef.current = {
                fileId: metadata.fileId,
                name: metadata.name,
                size: metadata.size,
                mimeType: metadata.type,
              };
              receivedChunksRef.current = [];
              receivedTotalRef.current = startOffset;
              receiveSamplesRef.current = [];
              setReceivedBytes(startOffset);
              setReceiveFileMeta({ name: metadata.name, size: metadata.size });
              setReceiveSpeedBps(0);
              setIsReceivePaused(false);
              setIsReceiveDiskSlow(false);
              setReceiveWriteLagBytes(0);
              setReceiveError(null);

              if (useOpfsForActive) {
                await initOpfsFile(metadata.fileId);
                // Keep confirmedWrittenBytes aligned with what the worker has
                // actually written, independent of the render cadence -
                // reportWriteLag() (called from the throttled progress block
                // below) reads this plain variable, not state.
                onChunkWritten(metadata.fileId, (currentOffset) => {
                  confirmedWrittenBytes = currentOffset;
                  // Writes keep draining even while the sender is paused for
                  // backpressure (no new chunks arriving) - this is the only
                  // place that can notice the lag has cleared and release it.
                  reportWriteLag();
                });
                // A write failure (quota exceeded, disk error) used to be
                // completely silent - the bytes were counted as received
                // even though they were never actually written, guaranteeing
                // a corrupted file with no indication anything went wrong.
                onWriteError(metadata.fileId, (error) => {
                  setReceiveError(`Failed to save incoming data: ${error}`);
                });
              }

              // Everything this offer needs to process a chunk correctly is
              // now settled - replay, in order, whatever arrived while that
              // was still in flight.
              receiveReady = true;
              const queued = pendingEarlyChunks;
              pendingEarlyChunks = [];
              queued.forEach(processIncomingChunk);

              const accept: FileTransferSignal = {
                type: 'FILE_ACCEPT',
                fileId: metadata.fileId,
                startByteOffset: startOffset,
              };
              dc.send(JSON.stringify(accept));
            } else if (msg.type === 'FILE_ACCEPT') {
              resumeOffsetsRef.current.set(msg.fileId, msg.startByteOffset);
            } else if (msg.type === 'TRANSFER_COMPLETE') {
              await finishReceive(msg.fileId);
              activeFileId = null;
            } else if (msg.type === 'TRANSFER_PAUSED') {
              if (fileMetadataRef.current?.fileId === msg.fileId) setIsReceivePaused(true);
            } else if (msg.type === 'TRANSFER_RESUMED') {
              if (fileMetadataRef.current?.fileId === msg.fileId) setIsReceivePaused(false);
            } else if (msg.type === 'WRITE_BACKPRESSURE') {
              // Not gated by fileId: this peer's receive side may have moved
              // on to reporting a release for a file we've since finished
              // sending - always honoring it (by peerId, not fileId) means a
              // stale "engaged" can never get stuck un-released.
              if (msg.engaged) backpressurePeersRef.current.add(peerId);
              else backpressurePeersRef.current.delete(peerId);
              setIsSendBackpressured(backpressurePeersRef.current.size > 0);
              // Flush the true current offset right as blocking engages (or
              // clears) - not whatever the chunk loop's last throttled tick
              // happened to show - so the sender's displayed progress can't
              // look like it's behind what the receiver already confirms.
              flushSendProgressNow(isSendBlocked());
              notifyMaybeUnblocked();
            }
          } catch (e) {
            console.error('DataChannel control-message handling error:', e);
          }
        })();
      } else {
        const rawBuffer = event.data as ArrayBuffer;
        if (!receiveReady) {
          // FILE_OFFER setup (IndexedDB lookup, OPFS init) hasn't finished
          // yet - hold onto this instead of processing it against
          // not-yet-settled state (or a mesh sender that never waits at
          // all before streaming - see RESUME_ACCEPT_WAIT_MS). Flushed in
          // arrival order the moment setup completes, below.
          pendingEarlyChunks.push(rawBuffer);
          return;
        }
        processIncomingChunk(rawBuffer);
      }
    };

    function processIncomingChunk(rawBuffer: ArrayBuffer) {
      const byteLength = rawBuffer.byteLength;
      const offsetForWrite = receivedTotalRef.current;

      if (useOpfsForActive && activeFileId) {
        writeOpfsChunk(activeFileId, rawBuffer, offsetForWrite);
      } else {
        receivedChunksRef.current.push(new Uint8Array(rawBuffer));
      }
      receivedTotalRef.current += byteLength;

      const now = Date.now();
      const samples = receiveSamplesRef.current;
      samples.push({ time: now, bytes: receivedTotalRef.current });
      pruneOldSamples(samples, now);

      const isLastChunk = fileMetadataRef.current
        ? receivedTotalRef.current >= fileMetadataRef.current.size
        : false;
      if (isLastChunk || now - lastReceiveUiUpdateRef.current > UI_UPDATE_THROTTLE_MS) {
        lastReceiveUiUpdateRef.current = now;
        setReceivedBytes(receivedTotalRef.current);
        setReceiveSpeedBps(computeSpeedBps(samples));
        if (fileMetadataRef.current) {
          reportTransferProgress(
            'receive',
            fileMetadataRef.current.name,
            fileMetadataRef.current.size,
            receivedTotalRef.current,
          );
        }
        reportWriteLag();
      }

      if (useOpfsForActive && activeFileId && isTransferDbSupported() && fileMetadataRef.current) {
        const meta = fileMetadataRef.current;
        void saveTransferProgress({
          fileId: activeFileId,
          name: meta.name,
          size: meta.size,
          mimeType: meta.mimeType,
          receivedBytes: receivedTotalRef.current,
          isCompleted: false,
          updatedAt: Date.now(),
        }).catch(() => {});
      }
    }
  }

  async function drainCandidateQueue(peerId: string, pc: RTCPeerConnection) {
    const queue = candidateQueues.current.get(peerId) || [];
    while (queue.length > 0) {
      const cand = queue.shift();
      if (cand) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (err) {
          console.warn(`Error draining candidate for ${peerId}:`, err);
        }
      }
    }
  }

  // Lightweight metadata-only ping for the live stats dashboard - filename,
  // size, bytes-so-far, queue position, and pause state, never the file
  // itself (which stays on the P2P data channel this function has no access
  // to). queueIndex/queueTotal/paused only ever apply to 'send'.
  function reportTransferProgress(
    direction: FileTransferProgressPayload['direction'],
    fileName: string,
    fileSize: number,
    bytesTransferred: number,
    queueIndex?: number,
    queueTotal?: number,
    paused?: boolean,
  ) {
    if (direction === 'send') {
      lastSendProgressRef.current = { fileName, fileSize, bytesTransferred, queueIndex, queueTotal };
    }
    if (!socketRef.current || !roomIdRef.current) return;
    socketRef.current.emit(SOCKET_EVENTS.FILE_TRANSFER_PROGRESS, {
      roomId: roomIdRef.current,
      direction,
      fileName,
      fileSize,
      bytesTransferred,
      queueIndex,
      queueTotal,
      paused,
    });
  }

  function closePeer(peerId: string) {
    peersRef.current.get(peerId)?.close();
    peersRef.current.delete(peerId);
    dataChannelsRef.current.delete(peerId);
    candidateQueues.current.delete(peerId);
    remoteDescriptionSet.current.delete(peerId);
    // A departed peer can no longer send a release - don't let it keep the
    // send loop blocked forever for everyone else.
    if (backpressurePeersRef.current.delete(peerId)) {
      setIsSendBackpressured(backpressurePeersRef.current.size > 0);
      flushSendProgressNow(isSendBlocked());
      notifyMaybeUnblocked();
    }
    updateConnectedPeerList();
  }

  useEffect(() => {
    void sweepStaleTransfers();

    //creates the Socket.IO client
    const socket = io(import.meta.env.VITE_SIGNALING_URL || 'http://localhost:4000', {
      transports: ['websocket'],
    });

    //now socket is accessible from the rest of the hook
    socketRef.current = socket;
    
    //Socket.iO connection succeeds , Socket.IO assigns the connection a socket ID
    socket.on('connect', () => {
      console.log('Signaling Socket connected:', socket.id);
      setIsSocketConnected(true);
    });

    //socket io Connection error
    socket.on('connect_error', (err) => {
      console.error('Signaling error:', err.message);
      setIsSocketConnected(false);
    });
  
    //server generates the room ID
    socket.on(SOCKET_EVENTS.ROOM_CREATED, (data: { roomId: string }) => {
      console.log('Room created:', data.roomId);
      setRoomId(data.roomId);  //store roomid in react state
    });

     //webrtc connection creation offer( A new peer joined -> We (existing member) initiate offer to that peer)
    socket.on(SOCKET_EVENTS.PEER_JOINED, async (data: { peerId: string }) => {
      console.log(`Peer joined: ${data.peerId} -> Initiating connection`);
      const pc = createPeerConnection(data.peerId);    //create webrtc connection between two peer
       
       //create actual webrtc datachanel for file transfer
      const dc = pc.createDataChannel('fileTransfer', 
        { ordered: true } //means messege /chunks arrive in ordered
      ); 
        
      dataChannelsRef.current.set(data.peerId, dc); //Store DataChannel
      bindDataChannel(dc, data.peerId);

      const offer = await pc.createOffer();//suppose A , Create an offer describing how I want to communicate with B
      await pc.setLocalDescription(offer); //then A stores that offer as its local WebRTC description.
      
      //sending signaling information
      socket.emit(SOCKET_EVENTS.SDP_OFFER, {
        targetPeerId: data.peerId,
        sdp: offer,
      });
    });

    //Joining peer receives existing room members list from Redis
    socket.on('room-users', async (data: { peers: string[] }) => {
      console.log(`Existing room peers from Redis:`, data.peers);
      // Wait for existing peers to send offers
      data.peers.forEach((peerId) => {
        if (!peersRef.current.has(peerId)) {
          createPeerConnection(peerId);
        }
      });
    });


    //3. Receive targeted SDP Offer -> reply with targeted Answer
    socket.on( SOCKET_EVENTS.SDP_OFFER,
         async (data: { senderPeerId: string; sdp: RTCSessionDescriptionInit }) => {
        console.log(`Received SDP Offer from ${data.senderPeerId}`);
        const pc = peersRef.current.get(data.senderPeerId) || createPeerConnection(data.senderPeerId);

        pc.ondatachannel = (event) => {
          console.log(`Received remote DataChannel from ${data.senderPeerId}`);
          dataChannelsRef.current.set(data.senderPeerId, event.channel);
          bindDataChannel(event.channel, data.senderPeerId);
        };

        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        remoteDescriptionSet.current.set(data.senderPeerId, true);
        await drainCandidateQueue(data.senderPeerId, pc);
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit(SOCKET_EVENTS.SDP_ANSWER, {
          targetPeerId: data.senderPeerId,
          sdp: answer,
        });
      },
    );

    // 4. Receive targeted SDP Answer
    socket.on(
      SOCKET_EVENTS.SDP_ANSWER,
      async (data: { senderPeerId: string; sdp: RTCSessionDescriptionInit }) => {
        console.log(`Received SDP Answer from ${data.senderPeerId}`);
        const pc = peersRef.current.get(data.senderPeerId);
       if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          remoteDescriptionSet.current.set(data.senderPeerId, true);
          await drainCandidateQueue(data.senderPeerId, pc);
    }
      },
    );

    // 5. Receive targeted ICE Candidate
    socket.on(
      SOCKET_EVENTS.ICE_CANDIDATE,
      async (data: { senderPeerId: string; candidate: RTCIceCandidateInit }) => {
        if (!data.candidate) return;
        const pc = peersRef.current.get(data.senderPeerId);
        const isReady = remoteDescriptionSet.current.get(data.senderPeerId);

        if (pc && isReady && pc.remoteDescription) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch (e) {
            console.warn(`Error adding ICE candidate:`, e);
          }
        } else {
          const queue = candidateQueues.current.get(data.senderPeerId) || [];
          queue.push(data.candidate);
          candidateQueues.current.set(data.senderPeerId, queue);
        }
      },
    );


    // 6. Handle peer leave / disconnect
    socket.on(SOCKET_EVENTS.LEAVE_ROOM, (data: { peerId: string }) => {
      console.log(` Peer left: ${data.peerId}`);
      closePeer(data.peerId);
    });

    return () => {
      socket.disconnect();
      peersRef.current.forEach((pc) => pc.close());
      peersRef.current.clear();
      dataChannelsRef.current.clear();
      // Safe to revoke/remove now - the page is navigating away from File
      // Share entirely, so any download the browser was still reading from
      // one of these is being abandoned by the browser's own unload handling
      // anyway, not by us guessing it was "probably done by now".
      pendingDownloadUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      pendingDownloadUrlsRef.current = [];
      pendingOpfsCleanupRef.current.forEach((id) => void removeOpfsFile(id).catch(() => {}));
      pendingOpfsCleanupRef.current = [];
    };
  },[updateConnectedPeerList])

  const createRoom = () => socketRef.current?.emit(SOCKET_EVENTS.CREATE_ROOM);

  const joinRoom = (targetRoomId: string) => {
    const cleanId = targetRoomId.trim();
    setRoomId(cleanId);
    roomIdRef.current = cleanId;
    socketRef.current?.emit(SOCKET_EVENTS.JOIN_ROOM, { roomId: cleanId });
  };

  // Streams a single file to all currently-open mesh channels, resuming from
  // a prior offset when exactly one peer is connected and that peer reports
  // (via FILE_ACCEPT) a partial receive already on disk - see the
  // RESUME_ACCEPT_WAIT_MS comment above for why mesh sends always restart
  // from 0 instead of guessing whose resume offset to honor.
  const sendOneFile = async (file: File, channels: RTCDataChannel[], queueIndex: number, queueTotal: number) => {
    const fileId = await computeFileId(file);
    activeSendFileIdRef.current = fileId;

    sentSamplesRef.current = [];
    lastSendUiUpdateRef.current = 0;
    setSendFileMeta({ name: file.name, size: file.size });
    setSendProgress(0);
    setSendSpeedBps(0);

    resumeOffsetsRef.current.delete(fileId);

    const offerMsg: FileTransferSignal = {
      type: 'FILE_OFFER',
      metadata: {
        fileId,
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        totalChunks: Math.ceil(file.size / CHUNK_SIZE),
        chunkSize: CHUNK_SIZE,
        salt: '',
      },
    };
    const offerJson = JSON.stringify(offerMsg);
    channels.forEach((dc) => dc.send(offerJson));

    // A pause held across a multi-file queue (never resumed before this
    // next file started) still applies - let the receiver know right away
    // instead of showing a progress bar stalled at 0% with no explanation.
    // (Backpressure doesn't need the same announcement: it's a per-peer
    // state the affected receiver already knows about and will re-assert on
    // its own against the new file if its disk is still behind.)
    if (isUserPausedRef.current) {
      const pausedMsg: FileTransferSignal = { type: 'TRANSFER_PAUSED', fileId };
      const pausedJson = JSON.stringify(pausedMsg);
      channels.forEach((dc) => dc.send(pausedJson));
    }

    let offset = 0;
    if (channels.length === 1) {
      await new Promise((resolve) => setTimeout(resolve, RESUME_ACCEPT_WAIT_MS));
      offset = resumeOffsetsRef.current.get(fileId) ?? 0;
    }
    setSendProgress(file.size > 0 ? offset / file.size : 0);
    lastSendProgressRef.current = { fileName: file.name, fileSize: file.size, bytesTransferred: offset, queueIndex, queueTotal };

    // Stream Chunks with Backpressure across all channels
    while (offset < file.size) {
      if (isSendBlocked()) {
        // Blocked mid-transfer (user pause and/or a receiver's disk falling
        // behind): stop pulling/sending chunks entirely and wait for an
        // explicit wake-up (see notifyMaybeUnblocked) instead of polling on
        // a timer - resuming takes effect on the very next tick instead of
        // up to 150ms late. Speed samples are cleared on resume so the rate
        // display doesn't show a misleading dip averaged over the stall.
        await waitForUnblock();
        continue;
      }

      const maxBuffered = Math.max(...channels.map((dc) => dc.bufferedAmount));
      if (maxBuffered > BUFFER_HIGH_WATERMARK) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }

      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const buffer = await slice.arrayBuffer();
      channels.forEach((dc) => dc.send(buffer));
      offset += buffer.byteLength;
      // Unthrottled - see the comment on lastSendProgressRef's declaration:
      // this must always reflect the true offset, not just at the throttled
      // UI tick below, so a sudden pause/backpressure mid-burst can still be
      // flushed to the UI accurately instead of showing a stale, too-low
      // number while the receiver (which has no such throttle) shows more.
      lastSendProgressRef.current = { fileName: file.name, fileSize: file.size, bytesTransferred: offset, queueIndex, queueTotal };

      const now = Date.now();
      const samples = sentSamplesRef.current;
      samples.push({ time: now, bytes: offset });
      pruneOldSamples(samples, now);

      if (offset >= file.size || now - lastSendUiUpdateRef.current > UI_UPDATE_THROTTLE_MS) {
        lastSendUiUpdateRef.current = now;
        setSendProgress(offset / file.size);
        setSendSpeedBps(computeSpeedBps(samples));
        reportTransferProgress('send', file.name, file.size, offset, queueIndex, queueTotal, false);
      }
    }

    const completeMsg: FileTransferSignal = { type: 'TRANSFER_COMPLETE', fileId };
    const completeJson = JSON.stringify(completeMsg);
    channels.forEach((dc) => dc.send(completeJson));
    resumeOffsetsRef.current.delete(fileId);
    activeSendFileIdRef.current = null;
    setSendSpeedBps(0);
  };

  // Pauses the file currently streaming (if any) - the sender loop just
  // stops pulling/sending further chunks until resumed. Broadcasts a
  // TRANSFER_PAUSED control message so receivers can show "paused" instead
  // of a stalled progress bar that looks broken.
  const pauseSend = () => {
    if (isUserPausedRef.current || !activeSendFileIdRef.current) return;
    isUserPausedRef.current = true;
    setIsSendPaused(true);
    const msg: FileTransferSignal = { type: 'TRANSFER_PAUSED', fileId: activeSendFileIdRef.current };
    const json = JSON.stringify(msg);
    dataChannelsRef.current.forEach((dc) => {
      if (dc.readyState === 'open') dc.send(json);
    });
    // The chunk loop stops updating sendProgress/reportTransferProgress the
    // instant it's blocked - flush the true up-to-the-moment value now, not
    // whatever the last throttled tick happened to show.
    flushSendProgressNow(true);
  };

  const resumeSend = () => {
    if (!isUserPausedRef.current || !activeSendFileIdRef.current) return;
    isUserPausedRef.current = false;
    setIsSendPaused(false);
    sentSamplesRef.current = [];
    notifyMaybeUnblocked();
    const msg: FileTransferSignal = { type: 'TRANSFER_RESUMED', fileId: activeSendFileIdRef.current };
    const json = JSON.stringify(msg);
    dataChannelsRef.current.forEach((dc) => {
      if (dc.readyState === 'open') dc.send(json);
    });
    flushSendProgressNow(isSendBlocked());
  };

  // Sends a queue of files sequentially (one fully completes before the next
  // starts) to ALL connected mesh peers.
  const broadcastFiles = async (files: File[]) => {
    const channels = Array.from(dataChannelsRef.current.values()).filter(
      (dc) => dc.readyState === 'open',
    );

    if (channels.length === 0) {
      throw new Error('No peers currently connected to receive file!');
    }
    if (files.length === 0) return;

    setSendQueueTotal(files.length);
    try {
      for (let i = 0; i < files.length; i++) {
        setSendQueueIndex(i + 1);
        await sendOneFile(files[i], channels, i + 1, files.length);
      }
    } finally {
      setSendQueueTotal(0);
      setSendQueueIndex(0);
    }
  };

  // Preserved for existing callers - a single file is just a queue of one.
  const broadcastFile = (file: File) => broadcastFiles([file]);

  return {
    roomId,
    connectedPeers,
    isSocketConnected,
    createRoom,
    joinRoom,
    broadcastFile,
    broadcastFiles,
    receivedBytes,
    receiveFileMeta,
    receiveSpeedBps,
    sendFileMeta,
    sendProgress,
    sendSpeedBps,
    sendQueueTotal,
    sendQueueIndex,
    isSendPaused,
    isSendBackpressured,
    isReceivePaused,
    isReceiveDiskSlow,
    receiveWriteLagBytes,
    receiveError,
    pauseSend,
    resumeSend,
  };
}
