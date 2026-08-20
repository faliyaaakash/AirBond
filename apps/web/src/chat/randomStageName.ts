const ADJECTIVES = [
  'Wild',
  'Fiery',
  'Quiet',
  'Brave',
  'Lucky',
  'Swift',
  'Calm',
  'Bold',
  'Bright',
  'Clever',
];
const ANIMALS = [
  'Wolf',
  'Fox',
  'Falcon',
  'Otter',
  'Bear',
  'Hawk',
  'Lynx',
  'Heron',
  'Raven',
  'Panther',
];

export function randomStageName(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${adjective} ${animal}`;
}
