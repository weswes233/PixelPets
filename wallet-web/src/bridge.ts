import './polyfills.ts';
import { getWallets } from '@wallet-standard/app';
import type { Wallet } from '@wallet-standard/base';
import { BridgeError, WalletController, isSolanaWallet } from './controller.ts';
import type { TransactionReview } from './transactions.ts';

type Listener = (serialized: string) => void;
const listeners = new Set<Listener>();
function notify(payload: unknown): void {
  const text = JSON.stringify(payload);
  for (const listener of listeners) { try { listener(text); } catch { /* A disposed game callback must not break the bridge. */ } }
}
const controller = new WalletController(undefined, data => notify({ id: 'wallet_changed', ok: true, data }), reviewTransaction);
const wallets = getWallets();

function reviewTransaction(summary: TransactionReview): Promise<boolean> {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog'); dialog.id = 'pet-wallet-dialog';
    const title = document.createElement('h2'); title.textContent = summary.title;
    const note = document.createElement('p'); note.textContent = summary.message;
    const details = document.createElement('dl');
    for (const [label, value] of [['Companion', summary.petName], ['Network', summary.network], ['Wallet', summary.address], ['Asset', summary.asset], ['Estimated total debit', `${summary.estimatedDebitSol} SOL`], ['Network fee (included)', `${summary.networkFeeSol} SOL`]]) {
      const term = document.createElement('dt'); term.textContent = label;
      const valueNode = document.createElement('dd'); valueNode.textContent = value; details.append(term, valueNode);
    }
    const accept = document.createElement('button'); accept.textContent = 'Looks right — continue in wallet';
    const cancel = document.createElement('button'); cancel.textContent = 'Not now'; cancel.className = 'wallet-cancel';
    const finish = (approved: boolean) => { dialog.close(); dialog.remove(); resolve(approved); };
    accept.addEventListener('click', () => finish(true)); cancel.addEventListener('click', () => finish(false));
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
    dialog.append(title, note, details, accept, cancel); document.body.append(dialog); dialog.showModal();
  });
}

function chooseWallet(recover = false): Promise<Wallet> {
  if (document.getElementById('pet-wallet-dialog')) return Promise.reject(new BridgeError('WALLET_BUSY', 'The wallet picker is already open.'));
  return new Promise((resolve, reject) => {
    const dialog = document.createElement('dialog');
    dialog.id = 'pet-wallet-dialog';
    const title = document.createElement('h2'); title.id = 'pet-wallet-title'; title.textContent = recover ? 'Recover your companions' : 'Connect a Solana wallet';
    const note = document.createElement('p'); note.id = 'pet-wallet-note'; note.textContent = recover
      ? 'Sign in with the wallet you linked before to open your original profile. This guest profile is not merged or deleted. Signing in moves no assets and costs no fee.'
      : 'Verify you own this wallet. Signing in moves no assets and costs no fee. Use Solana Devnet.';
    dialog.setAttribute('aria-labelledby', title.id); dialog.setAttribute('aria-describedby', note.id);
    const list = document.createElement('div'); list.className = 'wallet-list';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Keep playing without a wallet'; cancel.className = 'wallet-cancel';
    dialog.append(title, note, list, cancel); document.body.append(dialog);
    const finish = (wallet?: Wallet) => { off(); dialog.close(); dialog.remove(); wallet ? resolve(wallet) : reject(new BridgeError('USER_CANCELLED', 'Connection cancelled. Your progress is unaffected.')); };
    const render = () => {
      list.replaceChildren();
      const available = wallets.get().filter(isSolanaWallet);
      if (!available.length) { const empty = document.createElement('p'); empty.textContent = 'No Solana wallet found. Open this page in a wallet browser, or install a wallet extension (e.g. Phantom, Backpack, Solflare) and refresh.'; list.append(empty); }
      for (const wallet of available) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = wallet.name;
        button.addEventListener('click', () => finish(wallet)); list.append(button);
      }
    };
    const off = wallets.on('register', render);
    cancel.addEventListener('click', () => finish());
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(); });
    render(); dialog.showModal();
  });
}

async function request(serialized: string): Promise<void> {
  let id = 'invalid';
  try {
    if (typeof serialized !== 'string' || serialized.length > 8192) throw new BridgeError('INVALID_REQUEST', 'Invalid wallet request.');
    const message = JSON.parse(serialized);
    if (!message || typeof message.id !== 'string' || message.id.length > 100) throw new BridgeError('INVALID_REQUEST', 'Invalid request id.');
    id = message.id;
    let data: unknown;
    switch (message.method) {
      case 'set_session': data = controller.setSession(message.payload?.token); break;
      case 'status': data = await controller.refresh(); break;
      case 'connect': data = await controller.connect(await chooseWallet()); break;
      case 'recover': data = await controller.recover(await chooseWallet(true)); break;
      case 'disconnect': data = await controller.disconnect(); break;
      case 'register': data = await controller.register(message.payload?.pet_id); break;
      case 'checkpoint': data = await controller.checkpoint(message.payload?.pet_id); break;
      case 'sync_assets': data = await controller.syncAssets(); break;
      case 'care': data = await controller.care(message.payload?.pet_id, message.payload?.care); break;
      case 'rename': data = await controller.rename(message.payload?.pet_id, message.payload?.nickname); break;
      case 'journey_receipt': data = await controller.journeyReceipt(message.payload?.pet_id, message.payload?.trip_id, message.payload?.result_hash); break;
      case 'travel': data = await controller.travel(message.payload?.op, message.payload?.pet_id, message.payload?.trip_id, message.payload?.body); break;
      case 'offers': data = await controller.offers(message.payload?.cursor); break;
      default: throw new BridgeError('METHOD_UNSUPPORTED', 'This wallet action is not supported in this version.');
    }
    notify({ id, ok: true, data });
  } catch (error) {
    const reason = error instanceof BridgeError ? error : new BridgeError('WALLET_REQUEST_FAILED', 'The wallet request did not finish. Check the wallet prompt and retry.');
    notify({ id, ok: false, error: { code: reason.code, message: reason.message } });
  }
}

const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/wallet.css'; document.head.append(style);
Object.defineProperty(window, 'PetChainBridge', { value: Object.freeze({ request, subscribe(listener: Listener) { listeners.add(listener); return () => listeners.delete(listener); } }), writable: false });
