import { canonicalJson, sha256Hex } from './canonical.ts';
import type { Canonical } from './canonical.ts';

/** Day-one travel content. Versioned: a started trip keeps the versions it started with. */
export const CONTENT_VERSION = 1;
export const RULES_VERSION = 1;
export type Temperament = 'cautious' | 'curious' | 'greedy';
export type RouteId = 'sunny_market' | 'moonlit_lane';
export type PackingId = 'snack_tin' | 'tiny_lantern';
export type Tier = 'common' | 'repeat' | 'special' | 'clue';
type Text = { en: string; zh: string };
export type Postcard = { version: 1; story: Record<'en' | 'zh', { title: string; lines: string[] }>; message: Text };

export const temperaments: Record<Temperament, Text> = {
  cautious: { en: 'Cautious', zh: '谨慎' },
  curious: { en: 'Curious', zh: '好奇' },
  greedy: { en: 'Snack-loving', zh: '贪吃' },
};
/** Existing pets have no temperament field; they get their species' base temperament (codex P001–P003). */
export const speciesTemperament: Record<string, Temperament> = { moss: 'curious', puddle: 'greedy', wisp: 'cautious' };
export function temperamentOf(pet: { species_id: string; temperament?: string }): Temperament {
  return pet.temperament && pet.temperament in temperaments ? pet.temperament as Temperament : speciesTemperament[pet.species_id] ?? 'curious';
}

export const routes: Record<RouteId, { name: Text; blurb: Text; trait: 'sun' | 'moon'; commons: string[]; special: string }> = {
  sunny_market: {
    name: { en: 'Sunny Market', zh: '阳光集市' },
    blurb: { en: 'Striped awnings, warm stones and too many snacks.', zh: '条纹雨棚、晒暖的石头和数不清的点心。' },
    trait: 'sun', commons: ['warm_pebble', 'market_ticket', 'honey_bun'], special: 'golden_bell',
  },
  moonlit_lane: {
    name: { en: 'Moonlit Lantern Lane', zh: '月灯小径' },
    blurb: { en: 'A quiet path of paper lanterns after the stalls close.', zh: '收摊后挂满纸灯笼的安静小路。' },
    trait: 'moon', commons: ['moth_bookmark', 'dew_bottle', 'night_map'], special: 'last_lantern',
  },
};
export const packings: Record<PackingId, Text & { note: Text }> = {
  snack_tin: { en: 'Snack tin', zh: '点心盒', note: { en: 'Changes the story, not the odds.', zh: '只改变故事，不改变概率。' } },
  tiny_lantern: { en: 'Tiny lantern', zh: '小提灯', note: { en: 'Changes the story, not the odds.', zh: '只改变故事，不改变概率。' } },
};
export const collectibles: Record<string, { route: RouteId; rarity: 'common' | 'special'; name: Text; description: Text }> = {
  warm_pebble: { route: 'sunny_market', rarity: 'common', name: { en: 'Warm Pebble', zh: '晒暖的石子' }, description: { en: 'Still warm from the noon sun.', zh: '还留着正午的温度。' } },
  market_ticket: { route: 'sunny_market', rarity: 'common', name: { en: 'Paper Market Ticket', zh: '集市纸票' }, description: { en: 'Good for one ride on the tiny carousel.', zh: '可以坐一次小小的旋转木马。' } },
  honey_bun: { route: 'sunny_market', rarity: 'common', name: { en: 'Honey Bun Wrapper', zh: '蜂蜜面包纸' }, description: { en: 'The bun is gone. The memory is not.', zh: '面包吃完了，回忆还在。' } },
  golden_bell: { route: 'sunny_market', rarity: 'special', name: { en: 'Golden Awning Bell', zh: '金色檐铃' }, description: { en: 'Rings only when someone is kind.', zh: '只在有人温柔时响起。' } },
  moth_bookmark: { route: 'moonlit_lane', rarity: 'common', name: { en: 'Moth-wing Bookmark', zh: '蛾翼书签' }, description: { en: 'Pressed between two quiet pages.', zh: '夹在两页安静的书之间。' } },
  dew_bottle: { route: 'moonlit_lane', rarity: 'common', name: { en: 'Bottle of Dew', zh: '一瓶夜露' }, description: { en: 'Collected one drop at a time.', zh: '一滴一滴收集起来的。' } },
  night_map: { route: 'moonlit_lane', rarity: 'common', name: { en: 'Night Map Scrap', zh: '夜路地图残片' }, description: { en: 'Shows a path that only exists after dark.', zh: '画着只在天黑后出现的小路。' } },
  last_lantern: { route: 'moonlit_lane', rarity: 'special', name: { en: 'The Last Lantern', zh: '最后一盏灯' }, description: { en: 'Given by the vendor who watched the meteor with your pet.', zh: '和你的伙伴一起看流星的老板送的。' } },
};
/** Future companions: hints are records only. They create no asset and no claim right. */
export const clues: Record<string, Text> = {
  P011: { en: 'a capybara asleep in a cloud-shaped tub', zh: '一只睡在云朵澡盆里的水豚' },
  P012: { en: 'a capybara hugging an enormous stone pillow', zh: '一只抱着巨大石枕的水豚' },
  P013: { en: 'someone sharing a lotus-leaf parasol', zh: '有谁在分享荷叶伞' },
  P021: { en: 'a frowning cat leaving a gift at a doorstep', zh: '一只皱眉的猫把礼物放在门口' },
  P022: { en: 'a pot lid clattering in an empty alley', zh: '空巷里锅盖叮当作响' },
  P023: { en: 'a fork-tailed cat sorting symmetrical things', zh: '一只叉尾猫在整理对称的东西' },
};
/** Initial design assumption from the plan; integer percent weights. */
export const tiers: [Tier, number][] = [['common', 60], ['repeat', 25], ['special', 10], ['clue', 5]];
export const fallbackRule = 'repeat-without-owned-route-common->common';

/** Hash of every rule that can change a result. Changing any of these requires a new RULES_VERSION. */
export function lootTable(): Canonical {
  return ['pixel-pets:loot-table:v1', RULES_VERSION, CONTENT_VERSION,
    tiers.map(([tier, weight]) => [tier, weight]),
    (Object.keys(routes) as RouteId[]).sort().map(id => [id, [...routes[id].commons].sort(), routes[id].special]),
    Object.keys(clues).sort(), fallbackRule];
}
export const LOOT_TABLE_HASH = sha256Hex(canonicalJson(lootTable()));

// Story fragments are rendered from the public event code; translations never change the evidence.
const departures: Record<Temperament, Text> = {
  cautious: { en: 'checked the map twice, then set off', zh: '把地图看了两遍才出发' },
  curious: { en: 'bounced out the door before the map was folded', zh: '地图还没折好就蹦出了门' },
  greedy: { en: 'packed a second lunch "just in case" and left', zh: '“以防万一”多带了一份午饭才出门' },
};
const scenes: Record<RouteId, Record<Temperament, Text>> = {
  sunny_market: {
    cautious: { en: 'It skipped the busiest stalls and helped an old vendor fold her awning.', zh: '它绕开最热闹的摊位，帮一位老摊主收好了雨棚。' },
    curious: { en: 'It asked every stall what they sell and why. Some of them answered.', zh: '它挨个问摊主卖的是什么、为什么卖，有几位真的回答了。' },
    greedy: { en: 'It tasted three kinds of honey buns and rated them all "best".', zh: '它尝了三种蜂蜜面包，给每一种都打了“最好吃”。' },
  },
  moonlit_lane: {
    cautious: { en: 'It walked under every lantern, never between them, and found the way home lit.', zh: '它只走在灯笼底下，从不走进灯与灯之间，回家的路一直是亮的。' },
    curious: { en: 'It followed a moth to the end of the lane and watched a meteor with the last vendor.', zh: '它跟着一只飞蛾走到小径尽头，和最后一位摊主一起看了流星。' },
    greedy: { en: 'It traded a cookie for a moon-shaped rice cake. Fair trade, it says.', zh: '它用一块饼干换了一个月亮形的年糕，它说这很公平。' },
  },
};
const packingLines: Record<PackingId, Text> = {
  snack_tin: { en: 'The snack tin came back lighter.', zh: '点心盒回来时轻了不少。' },
  tiny_lantern: { en: 'The tiny lantern still had a little light left.', zh: '小提灯里还剩一点点光。' },
};
const tierLines: Record<Tier, Text> = {
  common: { en: 'It brought back a postcard and a small keepsake.', zh: '它带回了一张明信片和一件小纪念物。' },
  repeat: { en: 'It found another familiar keepsake and put it beside the first one.', zh: '它又找到一件熟悉的纪念物，把它放在了上次那件旁边。' },
  special: { en: 'It came home with something rare and glowing.', zh: '它带回了一件稀有又发着光的东西。' },
  clue: { en: 'No keepsake this time, but it saw {clue}. A new friend, maybe someday.', zh: '这次没有纪念物，但它看见了{clue}。也许以后会成为新朋友。' },
};

export type EventCode = string;
export function eventCode(route: RouteId, temperament: Temperament, packing: PackingId, tier: Tier, clue?: string): EventCode {
  return `${route}.${temperament}.${packing}.${tier}${clue ? `.${clue}` : ''}`;
}
export function parseEventCode(code: string): { route: RouteId; temperament: Temperament; packing: PackingId; tier: Tier; clue?: string } {
  const [route, temperament, packing, tier, clue, extra] = code.split('.');
  if (!(route in routes) || !(temperament in temperaments) || !(packing in packings) || !tiers.some(([t]) => t === tier) || extra !== undefined
    || (tier === 'clue') !== (clue !== undefined) || (clue !== undefined && !(clue in clues))) throw new Error('Unknown event code');
  return { route: route as RouteId, temperament: temperament as Temperament, packing: packing as PackingId, tier: tier as Tier, clue };
}
/** Story text for display only. The pet name is a client-side substitution and never enters a hash. */
export function renderStory(code: string, language: 'en' | 'zh'): { title: string; lines: string[] } {
  const event = parseEventCode(code);
  const title = language === 'en' ? `A trip to ${routes[event.route].name.en}` : `去${routes[event.route].name.zh}的旅行`;
  const departure = language === 'en' ? `Your companion ${departures[event.temperament].en}.` : `你的伙伴${departures[event.temperament].zh}。`;
  const tier = tierLines[event.tier][language].replace('{clue}', event.clue ? clues[event.clue][language] : '');
  return { title, lines: [departure, scenes[event.route][event.temperament][language], packingLines[event.packing][language], tier] };
}

/** A personal note, with no reward information, shown while the companion is away. */
export function departureNote(route: RouteId, temperament: Temperament, packing: PackingId): Text {
  const notes: Record<Temperament, Text> = {
    cautious: { en: `I've marked the way home from ${routes[route].name.en}. I'll be careful.`, zh: `去${routes[route].name.zh}的回程已经画在地图上啦。我会小心的。` },
    curious: { en: `I'm off to ${routes[route].name.en}! I'll bring a story back for you.`, zh: `我去${routes[route].name.zh}看看！等回来，把遇到的事讲给你听。` },
    greedy: { en: `I'm visiting ${routes[route].name.en}. If I find a good snack, I'll remember it for you.`, zh: `我去${routes[route].name.zh}逛逛。要是发现好吃的，我会记住名字告诉你。` },
  };
  const packed: Text = packing === 'snack_tin'
    ? { en: 'The snack tin is in my bag. Thank you for packing it.', zh: '点心盒已经装进包里啦，谢谢你帮我准备。' }
    : { en: 'I have your tiny lantern. It makes the road feel less lonely.', zh: '带上你准备的小提灯了，有它照着，路上就不孤单。' };
  return { en: `${notes[temperament].en} ${packed.en}`, zh: `${notes[temperament].zh}${packed.zh}` };
}

/** Saved once at reveal. Display prose is separate from the canonical result committed on Solana. */
export function renderPostcard(code: string): Postcard {
  const { temperament, route } = parseEventCode(code);
  const messages: Record<Temperament, Text> = {
    cautious: { en: 'I found my way home. Next time, I might try a slightly longer path.', zh: '我找到回家的路啦。下次，也许可以试着多走一小段。' },
    curious: { en: route === 'sunny_market' ? 'I still have so many questions about the market. Would you pack my bag again?' : 'The lane went farther than I expected. I wonder what is past the last lantern.', zh: route === 'sunny_market' ? '集市里还有好多事没问完呢。下次还能帮我准备行囊吗？' : '那条小路比我想的还长。最后一盏灯后面，又有什么呢？' },
    greedy: { en: 'The best part of a trip? Having someone at home to tell about the food.', zh: '旅行最开心的事？是回家以后，有人听我讲路上吃到了什么。' },
  };
  return { version: 1, story: { en: renderStory(code, 'en'), zh: renderStory(code, 'zh') }, message: messages[temperament] };
}
export function publicTravelCatalog(durationMs: number) {
  return {
    content_version: CONTENT_VERSION, rules_version: RULES_VERSION, loot_table_hash: LOOT_TABLE_HASH,
    demo: { duration_ms: durationMs, label: 'Demo trip · accelerated' },
    supplies: { daily_cap: 3, per_trip: 1, refill: 'Each UTC day your free supplies are topped up to 3. They have no cash value.' },
    routes: Object.entries(routes).map(([id, route]) => ({ id, name: route.name, blurb: route.blurb, trait: route.trait, collectibles: [...route.commons, route.special] })),
    packings: Object.entries(packings).map(([id, packing]) => ({ id, name: { en: packing.en, zh: packing.zh }, note: packing.note })),
    collectibles: Object.entries(collectibles).map(([id, item]) => ({ id, ...item })),
    temperaments: Object.entries(temperaments).map(([id, name]) => ({ id, name })),
    odds: { tiers: tiers.map(([tier, weight]) => ({ tier, percent: weight })), fallback: fallbackRule,
      note: 'Rewards are drawn by the server. The result is recorded on Solana when you save the journey receipt.' },
    disclosure: 'Keepsakes are in-game collection records, not tokens or NFTs, and have no cash value.',
  };
}
