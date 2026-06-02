export interface SoundOption {
  id: string;
  label: string;
  file: string;
}

export const SOUNDS: SoundOption[] = [
  { id: "thunderstorm", label: "雷雨交夹,窝在沙发", file: "/sounds/thunderstorm.mp3" },
  { id: "rain-pipa", label: "雨打琵琶,窗前写作", file: "/sounds/rain-pipa.mp3" },
  { id: "ocean", label: "海边听浪,放松身心", file: "/sounds/ocean.mp3" },
  { id: "spring", label: "春暖花开,阳台看书", file: "/sounds/spring.mp3" },
  { id: "snow", label: "大雪飘飘,烤火练字", file: "/sounds/snow.mp3" },
];

const CHIME_FILE = "/sounds/chime.mp3";

let bgAudio: HTMLAudioElement | null = null;

function ensureAudio(): HTMLAudioElement {
  if (!bgAudio) {
    bgAudio = new Audio();
    bgAudio.loop = true;
    bgAudio.preload = "auto";
  }
  return bgAudio;
}

export function playSound(id: string, volume: number): void {
  const opt = SOUNDS.find((s) => s.id === id);
  if (!opt) return;
  const audio = ensureAudio();
  if (!audio.src.endsWith(opt.file)) {
    audio.src = opt.file;
  }
  audio.volume = clampVolume(volume);
  void audio.play().catch(() => {
    // browser may reject playback (e.g. no user gesture); silently ignore
  });
}

export function stopSound(): void {
  if (!bgAudio) return;
  bgAudio.pause();
  bgAudio.currentTime = 0;
}

export function setVolume(volume: number): void {
  if (!bgAudio) return;
  bgAudio.volume = clampVolume(volume);
}

export function playChime(): void {
  const chime = new Audio(CHIME_FILE);
  chime.volume = 0.6;
  void chime.play().catch(() => {
    // chime is best-effort; ignore failures
  });
}

function clampVolume(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
