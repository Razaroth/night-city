export function levelDelta (playerLevel, baseLevel, maxDelta = 12) {
  return Math.min(maxDelta, Math.max(0, Math.floor(playerLevel || 1) - Math.floor(baseLevel || 1)))
}

export function rewardMultiplier (playerLevel, baseLevel) {
  return 1 + Math.min(1.5, levelDelta(playerLevel, baseLevel, 25) * 0.06)
}

export function lootRarityTier (item) {
  if (!item) return 0
  const explicit = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 }[item.rarity]
  if (explicit != null) return explicit
  if (item.id === 'rare-chip') return 2
  const value = item.value ?? 0
  if (value >= 3000) return 4
  if (value >= 1500) return 3
  if (value >= 700) return 2
  if (value >= 250) return 1
  return 0
}

export function scaledLootChance (baseChance, item, playerLevel) {
  const tier = lootRarityTier(item)
  if (!tier || baseChance >= 1) return baseChance
  const bonus = Math.min(0.5, Math.max(0, (playerLevel || 1) - 1) * tier * 0.0125)
  return Math.min(1, baseChance + bonus)
}
