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
    for (const [label, value] of [['伙伴', summary.petName], ['网络', summary.network], ['接收钱包', summary.address], ['资产地址', summary.asset], ['预计总支出', `${summary.estimatedDebitSol} SOL`], ['其中网络费', `${summary.networkFeeSol} SOL`]]) {
      const term = document.createElement('dt'); term.textContent = label;
      const valueNode = document.createElement('dd'); valueNode.textContent = value; details.append(term, valueNode);
    }
    const accept = document.createElement('button'); accept.textContent = '核对无误，前往钱包确认';
    const cancel = document.createElement('button'); cancel.textContent = '先不登记'; cancel.className = 'wallet-cancel';
    const finish = (approved: boolean) => { dialog.close(); dialog.remove(); resolve(approved); };
    accept.addEventListener('click', () => finish(true)); cancel.addEventListener('click', () => finish(false));
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
    dialog.append(title, note, details, accept, cancel); document.body.append(dialog); dialog.showModal();
  });
}

function chooseWallet(recover = false): Promise<Wallet> {
  if (document.getElementById('pet-wallet-dialog')) return Promise.reject(new BridgeError('WALLET_BUSY', '钱包选择窗口已打开。'));
  return new Promise((resolve, reject) => {
    const dialog = document.createElement('dialog');
    dialog.id = 'pet-wallet-dialog';
    const title = document.createElement('h2'); title.id = 'pet-wallet-title'; title.textContent = recover ? '找回已有伙伴' : '带上你的伙伴';
    const note = document.createElement('p'); note.id = 'pet-wallet-note'; note.textContent = recover
      ? '用原来绑定的钱包签名，找回原档案。当前游客伙伴不会合并或删除；你可以在游戏里切回。登录签名不转移资产，也不收网络费。'
      : '先验证钱包归属。登录签名不会转走资产，也不会收取网络费。';
    dialog.setAttribute('aria-labelledby', title.id); dialog.setAttribute('aria-describedby', note.id);
    const list = document.createElement('div'); list.className = 'wallet-list';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '先继续养宠物'; cancel.className = 'wallet-cancel';
    dialog.append(title, note, list, cancel); document.body.append(dialog);
    const finish = (wallet?: Wallet) => { off(); dialog.close(); dialog.remove(); wallet ? resolve(wallet) : reject(new BridgeError('USER_CANCELLED', '已取消连接，养成进度不受影响。')); };
    const render = () => {
      list.replaceChildren();
      const available = wallets.get().filter(isSolanaWallet);
      if (!available.length) { const empty = document.createElement('p'); empty.textContent = '没有发现 Solana 钱包。请在钱包内置浏览器打开，或安装浏览器钱包扩展后刷新。'; list.append(empty); }
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
    if (typeof serialized !== 'string' || serialized.length > 8192) throw new BridgeError('INVALID_REQUEST', '无效的钱包请求。');
    const message = JSON.parse(serialized);
    if (!message || typeof message.id !== 'string' || message.id.length > 100) throw new BridgeError('INVALID_REQUEST', '无效的请求编号。');
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
      case 'offers': data = await controller.offers(message.payload?.cursor); break;
      default: throw new BridgeError('METHOD_UNSUPPORTED', '当前版本不支持此钱包操作。');
    }
    notify({ id, ok: true, data });
  } catch (error) {
    const reason = error instanceof BridgeError ? error : new BridgeError('WALLET_REQUEST_FAILED', '钱包请求未完成，请检查钱包提示后重试。');
    notify({ id, ok: false, error: { code: reason.code, message: reason.message } });
  }
}

const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/wallet.css'; document.head.append(style);
Object.defineProperty(window, 'PetChainBridge', { value: Object.freeze({ request, subscribe(listener: Listener) { listeners.add(listener); return () => listeners.delete(listener); } }), writable: false });
