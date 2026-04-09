export interface BotPersonality {
  id: string;
  vpip: number;          // Voluntarily Put $ In Pot (0-1, higher = looser)
  pfr: number;           // Pre-Flop Raise (0-1, higher = more aggressive)
  aggression: number;    // Post-flop aggression factor (0-1)
  bluffFrequency: number; // How often to bluff (0-1)
  foldToPressure: number; // How easily folds to raises (0-1, higher = folds more)
  callDown: number;       // Tendency to call down with marginal hands (0-1)
}

export const BOT_PERSONALITIES: Record<string, BotPersonality> = {
  'sakura': {
    id: 'sakura',
    vpip: 0.18,
    pfr: 0.10,
    aggression: 0.25,
    bluffFrequency: 0.05,
    foldToPressure: 0.80,
    callDown: 0.20,
  },
  'ryu': {
    id: 'ryu',
    vpip: 0.45,
    pfr: 0.35,
    aggression: 0.80,
    bluffFrequency: 0.40,
    foldToPressure: 0.20,
    callDown: 0.60,
  },
  'hana': {
    id: 'hana',
    vpip: 0.25,
    pfr: 0.22,
    aggression: 0.65,
    bluffFrequency: 0.20,
    foldToPressure: 0.45,
    callDown: 0.40,
  },
  'yuki': {
    id: 'yuki',
    vpip: 0.55,
    pfr: 0.12,
    aggression: 0.30,
    bluffFrequency: 0.10,
    foldToPressure: 0.50,
    callDown: 0.65,
  },
  'akira': {
    id: 'akira',
    vpip: 0.60,
    pfr: 0.40,
    aggression: 0.90,
    bluffFrequency: 0.55,
    foldToPressure: 0.15,
    callDown: 0.50,
  },
};
