export interface CharacterProfile {
  id: string;
  name: string;
  nameJp: string;
  color: string;        // primary color
  colorSecondary: string;
  emoji: string;         // placeholder expression
  personality: string;
  greeting: string;
  winQuote: string;
  loseQuote: string;
  bluffQuote: string;
  foldQuote: string;
  thinkingQuote: string;
  chatMessages: string[];
}

export const DEALER_CHARACTER: CharacterProfile = {
  id: 'dealer',
  name: 'Miyako',
  nameJp: '都',
  color: '#FFD700',
  colorSecondary: '#B8860B',
  emoji: '👩',
  personality: 'elegant',
  greeting: 'Welcome to the table, darling~ Let\'s have a wonderful game!',
  winQuote: 'What a beautiful hand!',
  loseQuote: '',
  bluffQuote: '',
  foldQuote: '',
  thinkingQuote: '',
  chatMessages: [
    'New hand starting~ Good luck everyone!',
    'The flop is here... how exciting!',
    'Time for the turn card~',
    'And the river... this is the moment of truth!',
    'Showdown time! Let\'s see those cards~',
  ],
};

export const BOT_CHARACTERS: CharacterProfile[] = [
  {
    id: 'sakura',
    name: 'Sakura',
    nameJp: '桜',
    color: '#FF69B4',
    colorSecondary: '#FF1493',
    emoji: '🌸',
    personality: 'tight-passive',
    greeting: 'H-hello... I\'ll do my best today...',
    winQuote: 'Oh! I... I won? How wonderful!',
    loseQuote: 'I knew I should have been more careful...',
    bluffQuote: 'I-I\'m all in... please don\'t call!',
    foldQuote: 'Too scary for me... I\'ll fold.',
    thinkingQuote: 'Let me think about this carefully...',
    chatMessages: [
      'This hand is making me nervous...',
      'Good luck everyone!',
      'I hope I get good cards this time...',
      'Ah, that was a nice play!',
      'Should I call...? It\'s so hard to decide...',
    ],
  },
  {
    id: 'ryu',
    name: 'Ryu',
    nameJp: '龍',
    color: '#FF4500',
    colorSecondary: '#DC143C',
    emoji: '🐉',
    personality: 'loose-aggressive',
    greeting: 'Heh... ready to lose your chips?',
    winQuote: 'Too easy. Who\'s next?',
    loseQuote: 'Tch... you got lucky this time.',
    bluffQuote: 'All in. What are you gonna do about it?',
    foldQuote: 'Not worth my time.',
    thinkingQuote: 'Hmph...',
    chatMessages: [
      'This is getting boring. Let\'s raise the stakes!',
      'You think you can beat me? Think again.',
      'I smell fear...',
      'Come on, show me what you\'ve got!',
      'That\'s more like it!',
    ],
  },
  {
    id: 'hana',
    name: 'Hana',
    nameJp: '花',
    color: '#9370DB',
    colorSecondary: '#6A0DAD',
    emoji: '🌺',
    personality: 'tight-aggressive',
    greeting: 'Let\'s have a good game, shall we?',
    winQuote: 'Calculated. Just as planned.',
    loseQuote: 'Interesting play. I\'ll remember that.',
    bluffQuote: 'The math says I should raise here.',
    foldQuote: 'Not the right odds. I\'ll wait.',
    thinkingQuote: 'Analyzing the situation...',
    chatMessages: [
      'The pot odds are interesting here.',
      'Well played!',
      'This is a fascinating board texture.',
      'Let\'s see how this develops.',
      'Statistically speaking...',
    ],
  },
  {
    id: 'yuki',
    name: 'Yuki',
    nameJp: '雪',
    color: '#87CEEB',
    colorSecondary: '#4169E1',
    emoji: '❄️',
    personality: 'loose-passive',
    greeting: 'Yay~ Poker time! This is so fun!',
    winQuote: 'Woohoo! I won! Lucky~!',
    loseQuote: 'Aww, oh well! Next hand will be better!',
    bluffQuote: 'Teehee~ I\'m going big!',
    foldQuote: 'Nah, I\'ll pass on this one~',
    thinkingQuote: 'Hmm, what should I do~?',
    chatMessages: [
      'This is so much fun!',
      'Ooh, what a card!',
      'I just love playing poker~',
      'Hehe, let\'s see what happens!',
      'Are we having fun yet? I am!',
    ],
  },
  {
    id: 'akira',
    name: 'Akira',
    nameJp: '暁',
    color: '#00CED1',
    colorSecondary: '#008B8B',
    emoji: '🎭',
    personality: 'maniac',
    greeting: 'The stage is set... Let the game begin.',
    winQuote: 'Another act concluded perfectly.',
    loseQuote: 'Even the best actors miss a cue sometimes.',
    bluffQuote: 'Truth and lies... can you tell the difference?',
    foldQuote: 'I\'ll exit this scene gracefully.',
    thinkingQuote: 'The plot thickens...',
    chatMessages: [
      'Every hand is a new story.',
      'Can you read my poker face?',
      'The drama unfolds...',
      'What a twist!',
      'Life is but a stage, and poker is the greatest play.',
    ],
  },
];

export function getCharacterById(id: string): CharacterProfile | undefined {
  if (id === 'dealer') return DEALER_CHARACTER;
  return BOT_CHARACTERS.find(c => c.id === id);
}

export function getRandomBotCharacter(excludeIds: string[] = []): CharacterProfile {
  const available = BOT_CHARACTERS.filter(c => !excludeIds.includes(c.id));
  if (available.length === 0) return BOT_CHARACTERS[0];
  return available[Math.floor(Math.random() * available.length)];
}
