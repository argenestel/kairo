/** Back-compat re-export of the shared cross-chain ladder. */
export {
  plannedSeries,
  plannedSeries as basePlannedSeries,
  strikes,
  strikes as baseStrikes,
  ladderExpiries,
  ladderExpiries as baseLadderExpiries,
  tomorrow16Utc,
  nextFriday16Utc,
  lastFridayNextMonth16Utc,
  DEFAULT_STRIKE_STEPS,
  stepForAsset,
  type LadderAsset,
  type LadderAsset as BaseLadderAsset,
  type LadderOptions,
  type LadderOptions as BaseLadderOptions,
} from "./ladder.js";
