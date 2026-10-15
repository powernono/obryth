import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import nacl from "tweetnacl";
import {
  clientHandshakeStart,
  clientHandshakeFinish,
  decodePairingQR,
  generateKeyPairB64,
  parseS2C,
  type C2SMessage,
  type S2CMessage,
  type SecureChannel,
  type KeyPairB64,
} from "@prospero/protocol";
nacl.setPRNG((bytes, length) => bytes.set(Crypto.getRandomBytes(length)));
/** A pinned, encrypted direct Prospero connection. Mutating commands are never queued or replayed. */
export class RemoteAgent {
  private socket: WebSocket | null = null;
  private channel: SecureChannel | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastPong = 0;
  private ready = false;
  constructor(
    private onMessage: (message: S2CMessage) => void,
    private onStatus: (status: string) => void,
  ) {}
  async connect(code?: string) {
    this.close();
    const raw =
      code ?? (await SecureStore.getItemAsync("obryth.remote.pairing"));
    if (!raw) throw new Error("请粘贴电脑上生成的 Prospero 配对码");
    const pairing = decodePairingQR(raw);
    if (!pairing.addrs.length)
      throw new Error("此版本需要局域网或私人 VPN 地址");
    let identity: KeyPairB64;
    const saved = await SecureStore.getItemAsync("obryth.remote.identity");
    if (saved) identity = JSON.parse(saved);
    else {
      identity = generateKeyPairB64();
      await SecureStore.setItemAsync(
        "obryth.remote.identity",
        JSON.stringify(identity),
      );
    }
    let lastError: unknown;
    for (const address of pairing.addrs) {
      try {
        await this.open(
          address,
          pairing.port,
          pairing.pubKey,
          pairing.token,
          identity.publicKey,
        );
        await SecureStore.setItemAsync("obryth.remote.pairing", raw);
        return;
      } catch (error) {
        lastError = error;
        this.close();
      }
    }
    throw lastError ?? new Error("未能连接主机");
  }
  private open(
    address: string,
    port: number,
    pinnedKey: string,
    token: string,
    clientPubKey: string,
  ) {
    return new Promise<void>((resolve, reject) => {
      if (/[\s/@?#\\]/.test(address)) {
        reject(new Error("无效的主机地址"));
        return;
      }
      const url = `ws://${address.includes(":") ? `[${address}]` : address}:${port}/ws`;
      const socket = new WebSocket(url);
      this.socket = socket;
      const handshake = clientHandshakeStart();
      let phase = 0;
      let settled = false;
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("连接或握手超时"));
      }, 8000);
      this.onStatus(`正在连接 ${address}…`);
      socket.onopen = () => socket.send(handshake.frame);
      socket.onmessage = (event) => {
        if (this.socket !== socket) return;
        try {
          if (phase === 0) {
            const result = clientHandshakeFinish(
              handshake.state,
              String(event.data),
              pinnedKey,
              {
                type: "hello",
                token,
                clientPubKey,
                clientInfo: {
                  platform: Platform.OS === "ios" ? "ios" : "android",
                  appVersion: "0.1.0",
                },
              },
            );
            this.channel = result.channel;
            phase = 1;
            socket.send(result.frame);
            return;
          }
          if (!this.channel) throw new Error("Encrypted channel closed");
          const message = parseS2C(this.channel.open(String(event.data)));
          if (message.type === "hello.ok") {
            settled = true;
            this.ready = true;
            clearTimeout(timer);
            this.lastPong = Date.now();
            this.onStatus(`已连接 · ${message.host.name}`);
            this.heartbeat = setInterval(() => {
              if (Date.now() - this.lastPong > 45000) {
                this.onStatus("连接超时，请重新连接");
                this.close();
                return;
              }
              this.send({ type: "connection.ping", id: Crypto.randomUUID() });
            }, 15000);
            resolve();
          }
          if (message.type === "connection.pong") this.lastPong = Date.now();
          this.onMessage(message);
        } catch (error) {
          clearTimeout(timer);
          socket.close();
          this.onStatus("验证失败或数据损坏，请重新配对");
          if (!settled) reject(error);
        }
      };
      socket.onerror = () => {
        clearTimeout(timer);
        if (!settled)
          reject(
            new Error("主机不可达，请检查局域网/VPN 和 Prospero 监听地址"),
          );
      };
      socket.onclose = () => {
        clearTimeout(timer);
        if (this.socket !== socket) return;
        this.ready = false;
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = null;
        if (settled) this.onStatus("连接已断开，任务不会自动重发");
        else reject(new Error("主机拒绝连接，请检查配对授权"));
      };
    });
  }
  send(message: C2SMessage) {
    if (
      !this.ready ||
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN ||
      !this.channel
    )
      throw new Error("当前未连接；操作没有发送");
    this.socket.send(this.channel.seal(message));
  }
  close() {
    this.ready = false;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.socket?.close();
    this.socket = null;
    this.channel = null;
  }
}
