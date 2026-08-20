export type ConnectionType = 'direct' | 'relay' | 'unknown';

// Inspects the peer connection's own stats to classify how it actually
// connected. This runs entirely in the browser - the server has no visibility
// into this at all, which is exactly the point: reporting it back is the only
// way the dashboard can show it, and it's still just a one-word classification,
// never anything about the connection's traffic.
export async function classifyConnectionType(pc: RTCPeerConnection): Promise<ConnectionType> {
  try {
    const stats = await pc.getStats();

    let selectedPair: RTCIceCandidatePairStats | undefined;
    stats.forEach((report) => {
      if (!selectedPair && report.type === 'candidate-pair' && report.state === 'succeeded') {
        selectedPair = report as RTCIceCandidatePairStats;
      }
    });
    if (!selectedPair) return 'unknown';

    let localType: string | undefined;
    let remoteType: string | undefined;
    stats.forEach((report) => {
      const candidateReport = report as RTCStats & { candidateType?: string };
      if (report.id === selectedPair!.localCandidateId) {
        localType = candidateReport.candidateType;
      }
      if (report.id === selectedPair!.remoteCandidateId) {
        remoteType = candidateReport.candidateType;
      }
    });

    if (!localType || !remoteType) return 'unknown';
    return localType === 'relay' || remoteType === 'relay' ? 'relay' : 'direct';
  } catch {
    return 'unknown';
  }
}
