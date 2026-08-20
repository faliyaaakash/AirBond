import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useChatSocket } from './useChatSocket';
import ChatLanding from './ChatLanding';
import ChatRoom from './ChatRoom';

export default function ChatPage() {
  const { roomId: roomIdFromUrl } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const chat = useChatSocket();

  // Keep the URL pointed at the active room once joined, so it's shareable/bookmarkable.
  useEffect(() => {
    if (chat.phase === 'joined' && chat.room && chat.room.roomId !== roomIdFromUrl) {
      navigate(`/chat/room/${chat.room.roomId}`, { replace: true });
    }
  }, [chat.phase, chat.room, roomIdFromUrl, navigate]);

  // A room that expired mid-session no longer has a meaningful URL to sit on.
  useEffect(() => {
    if (chat.phase === 'closed' && roomIdFromUrl) {
      navigate('/chat', { replace: true });
    }
  }, [chat.phase, roomIdFromUrl, navigate]);

  if (chat.phase === 'joined' && chat.room) {
    const chatWithRouting = {
      ...chat,
      leaveRoom: () => {
        chat.leaveRoom();
        navigate('/chat');
      },
    };
    return <ChatRoom chat={chatWithRouting} />;
  }

  return (
    <ChatLanding
      isSocketConnected={chat.isSocketConnected}
      isJoining={chat.phase === 'joining'}
      joinError={chat.joinError}
      wasClosed={chat.phase === 'closed'}
      initialRoomId={roomIdFromUrl}
      onJoin={chat.joinRoom}
      onCreateRoom={chat.createRoom}
    />
  );
}
