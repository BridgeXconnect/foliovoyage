// One-off helper: resolve real Wikimedia Commons thumbnail URLs for each
// editorial subject, so the placeholder content ships with images that
// actually exist. Output is pasted into src/data/destinations.ts.
//
// Usage: node scripts/resolve-images.mjs

const subjects = {
  home_hero: "Oia Santorini sunset",

  // Bangkok
  bkk_hero: "Wat Arun temple Bangkok",
  bkk_grand_palace: "Grand Palace Bangkok",
  bkk_wat_pho: "Wat Pho reclining Buddha Bangkok temple",
  bkk_wat_arun: "Wat Arun Bangkok",
  bkk_chao_phraya: "Chao Phraya River express boat Bangkok",
  bkk_yaowarat: "Yaowarat Road Bangkok Chinatown night",
  bkk_chatuchak: "Chatuchak Weekend Market Bangkok",
  bkk_floating: "Damnoen Saduak floating market",
  bkk_ayutthaya: "Ayutthaya Wat Mahathat Buddha head",

  // Kyoto
  kyo_hero: "Fushimi Inari Taisha torii",
  kyo_fushimi: "Fushimi Inari torii gates",
  kyo_kinkakuji: "Kinkaku-ji golden pavilion",
  kyo_arashiyama: "Arashiyama bamboo grove",
  kyo_gion: "Gion district Kyoto",
  kyo_nishiki: "Nishiki Market Kyoto",
  kyo_kiyomizu: "Kiyomizu-dera",
  kyo_tea: "Japanese tea ceremony matcha",
  kyo_nara: "Nara deer Todaiji",

  // Lisbon
  lis_hero: "Lisbon Alfama viewpoint",
  lis_tram: "Lisbon tram 28",
  lis_belem: "Belem Tower Lisbon",
  lis_jeronimos: "Jeronimos Monastery Lisbon",
  lis_natas: "Pastel de nata",
  lis_alfama: "Alfama Lisbon street",
  lis_castle: "Sao Jorge Castle Lisbon",
  lis_sintra: "Pena Palace Sintra",
  lis_timeout: "Time Out Market Lisbon",

  // Rome
  rom_hero: "Colosseum Rome",
  rom_colosseum: "Colosseum interior Rome",
  rom_vatican: "St Peter's Basilica Rome",
  rom_forum: "Roman Forum",
  rom_trastevere: "Trastevere Rome street",
  rom_trevi: "Trevi Fountain Rome",
  rom_pantheon: "Pantheon Rome",
  rom_borghese: "Galleria Borghese Rome",
  rom_testaccio: "Rome pasta cacio e pepe",

  // Hanoi
  han_hero: "Hoan Kiem Lake Hanoi",
  han_hoankiem: "Ngoc Son Temple Hanoi",
  han_oldquarter: "Hanoi Old Quarter street",
  han_trainstreet: "Hanoi train street",
  han_temple_lit: "Temple of Literature Hanoi",
  han_puppet: "Vietnamese water puppet theatre",
  han_halong: "Ha Long Bay",
  han_ninhbinh: "Tam Coc Ninh Binh",
  han_eggcoffee: "Vietnamese egg coffee",

  // Bali
  bal_hero: "Tegallalang rice terraces Bali",
  bal_tegallalang: "Tegallalang rice terrace Ubud",
  bal_uluwatu: "Uluwatu Temple Bali",
  bal_tanahlot: "Tanah Lot temple",
  bal_monkey: "Ubud Monkey Forest",
  bal_waterfall: "Sekumpul waterfall Bali",
  bal_seminyak: "Seminyak beach Bali sunset",
  bal_kecak: "Kecak dance Bali",
  bal_batur: "Mount Batur sunrise Bali",
};

const WIDTH = 1280;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function resolve(term) {
  const url =
    "https://commons.wikimedia.org/w/api.php?" +
    new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: `filetype:bitmap ${term}`,
      gsrnamespace: "6",
      gsrlimit: "5",
      prop: "imageinfo",
      iiprop: "url|mime|size",
      iiurlwidth: String(WIDTH),
      format: "json",
      origin: "*",
    });
  const res = await fetch(url, {
    headers: { "User-Agent": "FolioVoyage-scaffold/0.1 (placeholder content)" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const pages = data?.query?.pages;
  if (!pages) return null;
  const candidates = Object.values(pages)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => p.imageinfo?.[0])
    .filter((ii) => ii && /^image\/(jpeg|png)$/.test(ii.mime) && ii.width >= 1000);
  const best = candidates[0];
  if (!best) return null;
  return best.thumburl || best.url;
}

const out = {};
for (const [key, term] of Object.entries(subjects)) {
  let url = "";
  for (let attempt = 0; attempt < 4 && !url; attempt++) {
    if (attempt > 0) await sleep(1500 * attempt);
    try {
      url = (await resolve(term)) ?? "";
    } catch {
      url = "";
    }
  }
  out[key] = url;
  console.error(`${url ? "ok  " : "MISS"} ${key}`);
  await sleep(500); // stay under the Commons API rate limit
}

console.log(JSON.stringify(out, null, 2));
