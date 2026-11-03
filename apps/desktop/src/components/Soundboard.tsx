import { useState, useEffect } from "react";

interface Sound {
  id: string;
  name: string;
  src: string;
  loop?: boolean;
}

interface SoundboardProps {
  sounds: Sound[];
}

export function Soundboard({ sounds }: SoundboardProps) {
  const [playing, setPlaying] = useState<Map<string, HTMLAudioElement>>(new Map());

  useEffect(() => {
    return () => {
      for (const audio of playing.values()) {
        audio.pause();
        audio.currentTime = 0;
      }
    };
  }, [playing]);

  function toggleSound(sound: Sound) {
    const audio = playing.get(sound.id);
    if (audio) {
      // Stop playing
      audio.pause();
      audio.currentTime = 0;
      const newPlaying = new Map(playing);
      newPlaying.delete(sound.id);
      setPlaying(newPlaying);
    } else {
      // Start playing
      const newAudio = new Audio(sound.src);
      if (sound.loop) {
        newAudio.loop = true;
      }
      newAudio.play().catch(console.error);
      const newPlaying = new Map(playing);
      newPlaying.set(sound.id, newAudio);
      setPlaying(newPlaying);
    }
  }

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold text-white mb-4">Soundboard</h2>
      {sounds.length === 0 ? (
        <p className="text-gray-400 text-sm">No sounds loaded.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {sounds.map((sound) => {
            const isPlaying = playing.has(sound.id);
            return (
              <button
                key={sound.id}
                onClick={() => toggleSound(sound)}
                className={`p-4 rounded-lg border-2 transition-all ${
                  isPlaying
                    ? "bg-blue-900/50 border-blue-500 text-blue-300"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
                }`}
              >
                <div className="font-medium text-sm mb-1">{sound.name}</div>
                <div className="text-xs text-gray-500">
                  {isPlaying ? "Playing..." : sound.loop ? "Loop" : "One-shot"}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
