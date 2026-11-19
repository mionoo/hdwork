export const orderSoundChoices = [
  { id: "pop", name: "Pop pendek", duration: "0,2 detik" },
  { id: "confirmation", name: "Nada konfirmasi", duration: "0,4 detik" },
  { id: "digital", name: "Bip digital", duration: "0,3 detik" },
  { id: "bell", name: "Lonceng ringan", duration: "1 detik" },
  { id: "double-ding", name: "Ding ganda", duration: "0,6 detik" },
  { id: "rising", name: "Tiga nada naik", duration: "0,8 detik" },
  { id: "knock", name: "Ketuk digital", duration: "0,3 detik" },
] as const

export type OrderSound = typeof orderSoundChoices[number]["id"] | "none"
export type OrderSoundSettings = { sound: OrderSound; volume: number }
const defaultSettings: OrderSoundSettings = { sound: "pop", volume: 0.5 }
const outputLevels: Record<Exclude<OrderSound, "none">, number> = {
  pop: 0.42,
  confirmation: 0.42,
  digital: 0.42,
  // Both bell tones start together. Their summed envelope peaks at 1.3.
  bell: 0.62,
  "double-ding": 0.46,
  rising: 0.46,
  knock: 0.54,
}
let audioContext: AudioContext | null = null
let lastPlayback: GainNode | null = null

export function readOrderSoundSettings(userId: number): OrderSoundSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(`hdwork:order-sound:${userId}`) || "null")
    const validSound = saved?.sound === "none" || orderSoundChoices.some((choice) => choice.id === saved?.sound)
    if (validSound && typeof saved.volume === "number" && saved.volume >= 0 && saved.volume <= 1) return saved
  } catch { /* Default settings also work when browser storage is unavailable. */ }
  return defaultSettings
}

export function saveOrderSoundSettings(userId: number, settings: OrderSoundSettings) {
  try { localStorage.setItem(`hdwork:order-sound:${userId}`, JSON.stringify(settings)) }
  catch { /* The current tab can still use the selected sound. */ }
}

export function orderSoundReady() {
  return audioContext?.state === "running"
}

export async function activateOrderSound() {
  audioContext ??= new AudioContext()
  await audioContext.resume()
  if (!orderSoundReady()) throw new Error("Klik Aktifkan suara untuk mengizinkan notifikasi.")
}

export function playOrderSound({ sound, volume }: OrderSoundSettings) {
  if (sound === "none" || volume === 0) return
  const context = audioContext
  if (!context || context.state !== "running") throw new Error("Aktifkan suara agar order baru terdengar.")
  lastPlayback?.disconnect()
  const output = context.createGain()
  output.gain.value = volume * outputLevels[sound]
  output.connect(context.destination)
  lastPlayback = output
  const start = context.currentTime

  function tone(frequency: number, offset: number, duration: number, strength = 1, endFrequency = frequency) {
    const oscillator = context!.createOscillator()
    const envelope = context!.createGain()
    oscillator.type = "sine"
    oscillator.frequency.setValueAtTime(frequency, start + offset)
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + offset + duration)
    envelope.gain.setValueAtTime(0, start + offset)
    envelope.gain.linearRampToValueAtTime(strength, start + offset + 0.008)
    envelope.gain.exponentialRampToValueAtTime(0.001, start + offset + duration)
    oscillator.connect(envelope)
    envelope.connect(output)
    oscillator.start(start + offset)
    oscillator.stop(start + offset + duration + 0.01)
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect() }
  }

  // Original synthesized tones. No external audio files are needed.
  switch (sound) {
    case "pop":
      tone(1050, 0, 0.18, 1, 650)
      break
    case "confirmation":
      tone(784, 0, 0.18)
      tone(1047, 0.14, 0.22)
      break
    case "digital":
      tone(988, 0, 0.1)
      tone(988, 0.14, 0.1)
      break
    case "bell":
      tone(880, 0, 1)
      tone(1760, 0, 0.65, 0.3)
      break
    case "double-ding":
      tone(988, 0, 0.23)
      tone(1319, 0.27, 0.33)
      break
    case "rising":
      tone(660, 0, 0.2)
      tone(880, 0.22, 0.2)
      tone(1175, 0.44, 0.36)
      break
    case "knock":
      tone(560, 0, 0.1, 1, 340)
      tone(560, 0.15, 0.13, 0.8, 380)
      break
  }
}
