export interface CoverEffectAttributes {
  number?: string
  rarity: string
  set?: string
  subtypes?: string
  supertype?: string
  trainerGallery?: 'true'
}

export const coverEffectDefinitions = [
  {
    value: 'amazingRare',
    attrs: {
      rarity: 'amazing rare',
    },
  },
  {
    value: 'radiantHolo',
    attrs: {
      rarity: 'radiant rare',
    },
  },
  {
    value: 'vMax',
    attrs: {
      rarity: 'rare holo vmax',
      supertype: 'pokémon',
    },
  },
  {
    value: 'vStar',
    attrs: {
      rarity: 'rare holo vstar',
    },
  },
] as const satisfies ReadonlyArray<{
  attrs: CoverEffectAttributes
  value: string
}>

export type CoverEffectPreset = (typeof coverEffectDefinitions)[number]['value']

export const defaultCoverEffectPreset: CoverEffectPreset = 'vStar'

export const coverEffectPresets = coverEffectDefinitions.map(definition => definition.value)

export const legacyCoverEffectPresetMap = {
  'rainbow': 'radiantHolo',
  'v-series': 'vMax',
} as const satisfies Record<string, CoverEffectPreset>

export const coverEffectAttributesByPreset: Record<CoverEffectPreset, CoverEffectAttributes> = Object.fromEntries(
  coverEffectDefinitions.map(definition => [definition.value, definition.attrs]),
) as Record<CoverEffectPreset, CoverEffectAttributes>

export function isCoverEffectPreset(value: unknown): value is CoverEffectPreset {
  return typeof value === 'string' && coverEffectPresets.includes(value as CoverEffectPreset)
}
