# PixelPets integration contract v1

Project: original pixel pets, Godot 4.5.2 GDScript + TypeScript API + Solana/Core/Anchor. Final target is mainnet; this file is an implementation contract, not evidence of deployment.

## Ownership of work

- game agent: `game/` only, including original code-drawn sprites and game headless tests.
- server agent: `server/` and `server/package.json` only.
- chain agent: `chain/` and chain evidence docs only.
- root: workspace package/lockfile, `wallet-web/`, `shared/`, `tools/`, `deploy/`, integration and release checks.

## Development ports and build

API listens on `127.0.0.1:9782` by default. Root web development/server uses `127.0.0.1:9783`, proxies `/api/` to API. Production same-origin HTTPS. Native Godot uses `http://127.0.0.1:9782` or a configured HTTPS API URL. Web uses its origin. API paths below include `/api/v1`.

## API wire format

JSON response: success `{ "ok": true, "data": ... }`, failure `{ "ok": false, "error": { "code": "...", "message": "..." } }`. All dates UTC ISO strings; all chain amounts decimal strings. Guest bearer token generated server-side; native client may store guest token locally. Wallet auth/session is separate; never trust wallet address input alone. Request body max 32KB.

- `POST /api/v1/guests` `{}` -> `{token, user_id}`. Token is secret and must not enter logs/URLs.
- `GET /api/v1/catalog` -> `{species:[{id,name,description,forms:[{id,name,description}]}]}`.
- `GET /api/v1/pets` bearer -> `{pets: Pet[]}`.
- `POST /api/v1/pets` bearer `{species_id, nickname, event_id}` -> `{pet: Pet}`. Up to 3 guest pets total initially. This is offchain adoption, not NFT minting.
- `POST /api/v1/pets/:id/care` bearer `{action:"feed"|"play"|"rest"|"explore",event_id,choice?:"moon"|"sun"}` -> `{pet:Pet,event:{id,message,applied, next_allowed_at?}}`.
- `PATCH /api/v1/pets/:id` bearer `{nickname}` -> `{pet:Pet}`.
- `GET /api/v1/journal` bearer -> `{entries:[{id,pet_id,message,created_at}]}`.
- `GET /api/v1/health` -> `{service,storage,chain:{network,configured,program_id}, ai:{configured}}`; never secrets.
- `GET /api/v1/chain/config` -> `{network,program_id,collection_address,enabled,rpc_url?}` public information only. Unconfigured returns enabled=false.
- `GET /api/v1/offers?limit=16&cursor=<offer>` bearer -> finalized read-only offer page; amounts, nonce and checkpoint are decimal strings. Returns `offers,scanned,rejected,next_cursor,has_more,slot,chain_time`; RPC failures are errors, not an empty market.
- `GET /api/v1/offers/:asset/:nonce` bearer -> verified offer details, including expired but unclosed offers.
- Wallet authentication and persistent claim/checkpoint routes are documented in `server/README.md`. Mutation routes for marketplace settlement remain unavailable; never simulate blockchain success.

Pet: `{id,species_id,nickname,form:"seed"|"sun"|"moon",bond:number,energy:number,mood:number,care_count:number,created_at,updated_at,revision:number,traits:{sun:number,moon:number},chain:{status:"unregistered"|"pending"|"registered",network?:string,asset_address?:string},favorite:"sun"|"moon"}`.

Canonical species: `moss` (苔苔, curious cat), `puddle` (啵啵, mellow frog), `wisp` (微光, shy ghost). Form seed is the starting pet, not a plant. Grow at bond >= 6, based on sun/moon preferences from care/explore. No death/punishment. Care cooldowns are server time; display friendly next action. Client data not authority. Small demo can obtain first growth in several minutes without clock edits. Server returns action-specific reactions.

## Godot UI and bridge

Pure GDScript with Compatibility renderer, Web single-threaded + Windows. Responsive min 360x640 portrait and 1000x700 landscape. Original 32x32 pixel characters drawn through code, closest/nearest filtering, warm cream/ink/coral/mint palette. Main scene playable in desktop/headless. Scene path `res://main.tscn`.

Tabs: companion, collection, journal, trade (with actual connection status). No fake balances/assets/trades. Chain offline means clear unavailable label with playable online care unaffected.

Godot gets `window.PetChainBridge` on Web. Interface callable `request(JSON_STRING)` and `subscribe(callback)`; root supplies. JSON request `{id,method,payload}`. Methods initially `connect`,`disconnect`,`status`,`register`,`offers`. Callback receives one JSON string `{id,ok,data?,error?}`. Callback reference retained. Wallet not connected should explain and trigger actual wallet picker; no mock connection. Native chain actions may open configured browser page; do not pretend JSBridge works in EXE.

Game HTTP implementation should remain usable without wallet-web; show service unavailable/retry rather than silently create a trusted local pet. Optional explicitly labelled offline trial is future work.

## Security / persistence

No user private keys in app/source. Canonical asset identity includes network+program+asset. No fake test success. Tests use temporary storage and independent accounts. Root integrates dependencies after agents write their package requirements. All modules document actual limitations.
