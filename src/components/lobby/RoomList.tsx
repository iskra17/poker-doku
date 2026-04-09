'use client';

import { motion } from 'framer-motion';
import { useGameStore } from '@/lib/store/game-store';
import Button from '../ui/Button';

interface RoomListProps {
  onJoin: (roomId: string) => void;
}

export default function RoomList({ onJoin }: RoomListProps) {
  const { rooms } = useGameStore();

  return (
    <div className="max-w-3xl mx-auto px-3 md:px-4">
      <div className="flex items-center justify-between mb-3 md:mb-4">
        <h2 className="text-purple-300 font-bold text-base md:text-lg">Available Tables</h2>
        <Button
          variant="primary"
          size="sm"
          onClick={() => useGameStore.getState().setShowCreateRoom(true)}
        >
          + Create
        </Button>
      </div>

      <div className="space-y-2 md:space-y-3">
        {rooms.map((room, i) => (
          <motion.div
            key={room.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-[#1a1028]/80 backdrop-blur-sm border border-purple-500/20 rounded-xl p-3 md:p-4 flex items-center justify-between hover:border-purple-500/40 transition-all active:scale-[0.98]"
          >
            <div className="flex items-center gap-3">
              {/* Table icon */}
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-purple-600/30 to-pink-600/30 flex items-center justify-center text-xl md:text-2xl border border-purple-500/20 shrink-0">
                🎴
              </div>
              <div className="min-w-0">
                <h3 className="text-white font-bold text-sm md:text-base truncate">{room.name}</h3>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs md:text-sm text-gray-400 mt-0.5">
                  <span>Blinds: <span className="text-yellow-300">{room.blinds}</span></span>
                  <span>
                    <span className={room.playerCount >= room.maxPlayers ? 'text-red-400' : 'text-green-400'}>
                      {room.playerCount}/{room.maxPlayers}
                    </span>
                  </span>
                  <span className={`${room.status === 'Playing' ? 'text-green-400' : 'text-gray-400'}`}>
                    {room.status}
                  </span>
                </div>
              </div>
            </div>

            <Button
              variant={room.playerCount >= room.maxPlayers ? 'secondary' : 'success'}
              size="sm"
              disabled={room.playerCount >= room.maxPlayers}
              onClick={() => onJoin(room.id)}
            >
              {room.playerCount >= room.maxPlayers ? 'Full' : 'Join'}
            </Button>
          </motion.div>
        ))}

        {rooms.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <p className="text-4xl mb-3">🃏</p>
            <p className="text-sm">No tables available. Create one to start playing!</p>
          </div>
        )}
      </div>
    </div>
  );
}
