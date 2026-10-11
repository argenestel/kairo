import type { MascotMood, MascotPose } from './types';

/** Tiny kawaii helper set for UwU copy. */
export const kaomoji = {
  neutral: '(・ω・)',
  happy: '(＾▽＾)',
  excited: '(｡•̀ᴗ-)✧',
  worried: '(´• ω •`)',
  wink: '(^_−)☆',
  sleepy: '(´-ω-`)',
  cheer: '(๑˃ᴗ˂)ﻭ',
  sparkle: '✧｡٩(ˊᗜˋ)و✧*｡',
  love: '(♡˙︶˙♡)',
  yes: '(ゝ◡╹)ノ',
  ticket: '(≧◡≦) ♪',
  wave: '(´ ▽ `)ﾉ',
  think: '(・・?)',
  flex: '(ง •̀_•́)ง',
  peek: '(⁄ ⁄•⁄ω⁄•⁄ ⁄)',
} as const;

export type KaomojiKey = keyof typeof kaomoji;

export function kaomojiFor(mood: MascotMood, pose: MascotPose = 'idle'): string {
  if (pose === 'cheer') return kaomoji.cheer;
  if (pose === 'hold-ticket') return kaomoji.ticket;
  return kaomoji[mood];
}
