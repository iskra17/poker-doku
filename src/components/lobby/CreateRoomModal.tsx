'use client';

import { useState } from 'react';
import { useGameStore } from '@/lib/store/game-store';
import Modal from '../ui/Modal';
import Button from '../ui/Button';

const BLIND_LEVELS = [
  { sb: 5, bb: 10, min: 200, max: 1000 },
  { sb: 10, bb: 20, min: 400, max: 2000 },
  { sb: 25, bb: 50, min: 1000, max: 5000 },
  { sb: 50, bb: 100, min: 2000, max: 10000 },
  { sb: 100, bb: 200, min: 4000, max: 20000 },
];

export default function CreateRoomModal() {
  const { showCreateRoom, setShowCreateRoom, createRoom } = useGameStore();
  const [name, setName] = useState('');
  const [blindIndex, setBlindIndex] = useState(1);

  const blind = BLIND_LEVELS[blindIndex];

  const handleCreate = () => {
    const roomName = name.trim() || `Table ${Math.floor(Math.random() * 1000)}`;
    createRoom({
      name: roomName,
      smallBlind: blind.sb,
      bigBlind: blind.bb,
      minBuyIn: blind.min,
      maxBuyIn: blind.max,
    });
    setName('');
  };

  return (
    <Modal isOpen={showCreateRoom} onClose={() => setShowCreateRoom(false)} title="Create Table">
      <div className="space-y-4">
        {/* Table name */}
        <div>
          <label className="text-gray-400 text-sm block mb-1">Table Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Enter table name..."
            className="w-full bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2 text-white placeholder:text-gray-500 focus:outline-none focus:border-purple-500/50"
          />
        </div>

        {/* Blind level */}
        <div>
          <label className="text-gray-400 text-sm block mb-2">Blind Level</label>
          <div className="grid grid-cols-5 gap-2">
            {BLIND_LEVELS.map((bl, i) => (
              <button
                key={i}
                onClick={() => setBlindIndex(i)}
                className={`py-2 rounded-lg text-sm font-bold transition-all ${
                  blindIndex === i
                    ? 'bg-purple-600 text-white border border-purple-400'
                    : 'bg-gray-800/50 text-gray-400 border border-gray-700/30 hover:border-purple-500/30'
                }`}
              >
                {bl.sb}/{bl.bb}
              </button>
            ))}
          </div>
        </div>

        {/* Info */}
        <div className="bg-gray-800/30 rounded-lg p-3 text-sm">
          <div className="flex justify-between text-gray-400">
            <span>Buy-in Range</span>
            <span className="text-yellow-300">{blind.min} - {blind.max}</span>
          </div>
          <div className="flex justify-between text-gray-400 mt-1">
            <span>Max Players</span>
            <span className="text-white">6</span>
          </div>
        </div>

        {/* Create button */}
        <Button variant="primary" size="lg" className="w-full" onClick={handleCreate}>
          Create Table
        </Button>
      </div>
    </Modal>
  );
}
