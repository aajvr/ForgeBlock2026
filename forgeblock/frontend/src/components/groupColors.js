// Groups have no stored colour, so each one keeps a fixed colour from its id.
// [main, deep] pairs: calm Fluent-style blues, teals and purples. Same set as the
// Clients folders, so a group's tag in Records matches its folder.
export const GROUP_COLOURS = [
  ['#0f6cbd', '#0c4f8c'],
  ['#0f766e', '#0b4f4a'],
  ['#4338ca', '#312e81'],
  ['#7e22ce', '#581c87'],
  ['#0369a1', '#0c4a6e'],
  ['#a21caf', '#701a75'],
]
export const GREY_GROUP = ['#64748b', '#475569']
export const groupColour = (groupId) => (groupId ? GROUP_COLOURS[groupId % GROUP_COLOURS.length] : GREY_GROUP)
