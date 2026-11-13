// One signing-pad size for every dynamic capture (client enrollment and Screen
// a signature), so references and questioned signatures are captured the same
// way: full card width, 340px tall on desktop, and on touch devices
// (pointer: coarse) min(52vh, 460px).
export const PAD_HEIGHT = { desktop: 340, touch: 'min(52vh, 460px)' }

// The same sizes as Tailwind classes (literal, so Tailwind generates them).
export const PAD_HEIGHT_CLASS = 'h-[340px] [@media(pointer:coarse)]:h-[min(52vh,460px)]'
