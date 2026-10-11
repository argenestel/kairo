export const MASCOT_WHO = ['base', 'arbi', 'hyper', 'sol', 'mon'] as const;
export const MASCOT_MOODS = ['neutral', 'happy', 'excited', 'worried', 'wink', 'sleepy'] as const;
export const MASCOT_POSES = ['idle', 'point', 'cheer', 'hold-ticket'] as const;

export type MascotWho = (typeof MASCOT_WHO)[number];
export type MascotMood = (typeof MASCOT_MOODS)[number];
export type MascotPose = (typeof MASCOT_POSES)[number];

export type MascotProps = {
  who: MascotWho;
  mood?: MascotMood;
  pose?: MascotPose;
  size?: number;
  className?: string;
  animated?: boolean;
};

export type MascotPalette = {
  outline: string;
  skin: string;
  skinShadow: string;
  blush: string;
  hair: string;
  hairDark: string;
  hairLight: string;
  hairAccent: string;
  iris: string;
  irisDark: string;
  pupil: string;
  lash: string;
  brow: string;
  mouth: string;
  tongue: string;
  top: string;
  topDark: string;
  topLight: string;
  collar: string;
  bottom: string;
  bottomDark: string;
  shoe: string;
  shoeAccent: string;
  accessory: string;
  accessoryDark: string;
  accent: string;
};

export type PartProps = {
  who: MascotWho;
  mood: MascotMood;
  pose: MascotPose;
  p: MascotPalette;
  uid: string;
};
