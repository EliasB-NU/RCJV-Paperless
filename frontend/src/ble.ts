export type RobotSlot = {
  id: string;
  label: string;
  team: 'team1' | 'team2';
  index: number;
};

export type RobotConnection = {
  slot: RobotSlot;
  device?: BluetoothDeviceLike;
  tx?: BluetoothRemoteGATTCharacteristicLike;
  rx?: BluetoothRemoteGATTCharacteristicLike;
  status: string;
};

type BluetoothDeviceLike = {
  id: string;
  name?: string;
  gatt?: {
    connected: boolean;
    connect: () => Promise<BluetoothRemoteGATTServerLike>;
  };
  addEventListener?: (event: string, handler: () => void) => void;
};

type BluetoothRemoteGATTServerLike = {
  getPrimaryService: (uuid: string) => Promise<BluetoothRemoteGATTServiceLike>;
};

type BluetoothRemoteGATTServiceLike = {
  getCharacteristic: (uuid: string) => Promise<BluetoothRemoteGATTCharacteristicLike>;
};

type BluetoothRemoteGATTCharacteristicLike = {
  writeValue: (value: Uint8Array) => Promise<void>;
  writeValueWithoutResponse?: (value: Uint8Array) => Promise<void>;
  startNotifications?: () => Promise<BluetoothRemoteGATTCharacteristicLike>;
  addEventListener?: (event: string, handler: (event: Event) => void) => void;
};

const serviceUuid = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const txUuid = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const rxUuid = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

const msg = {
  setName: 2,
  setScore: 3,
  play: 4,
  stop: 5,
  damage: 6,
  halfTime: 7,
  gameOver: 8
};

export function bluetoothSupported(): boolean {
  return 'bluetooth' in navigator;
}

export class RobotBleController {
  connections = new Map<string, RobotConnection>();
  onPenaltyRequest?: (slot: RobotSlot) => void;

  constructor(slots: RobotSlot[]) {
    for (const slot of slots) {
      this.connections.set(slot.id, { slot, status: 'Disconnected' });
    }
  }

  list(): RobotConnection[] {
    return Array.from(this.connections.values());
  }

  async pair(slotID: string) {
    const connection = this.require(slotID);
    if (!bluetoothSupported()) throw new Error('Web Bluetooth is not available in this browser');
    const bluetooth = (navigator as Navigator & { bluetooth: { requestDevice: (options: unknown) => Promise<BluetoothDeviceLike> } }).bluetooth;
    connection.status = 'Pairing...';
    const device = await bluetooth.requestDevice({
      filters: [{ services: [serviceUuid] }, { namePrefix: 'RCJ' }, { namePrefix: 'soccer' }],
      optionalServices: [serviceUuid]
    });
    connection.device = device;
    device.addEventListener?.('gattserverdisconnected', () => {
      connection.status = 'Disconnected';
    });
    await this.connect(slotID);
  }

  async connect(slotID: string) {
    const connection = this.require(slotID);
    if (!connection.device?.gatt) throw new Error('No Bluetooth device selected');
    connection.status = 'Connecting...';
    const server = await connection.device.gatt.connect();
    const service = await server.getPrimaryService(serviceUuid);
    connection.tx = await service.getCharacteristic(txUuid);
    connection.rx = await service.getCharacteristic(rxUuid);
    await connection.rx.startNotifications?.();
    connection.rx.addEventListener?.('characteristicvaluechanged', (event: Event) => {
      const value = (event.target as unknown as { value?: DataView }).value;
      if (value?.byteLength && value.getUint8(0) === 10) this.onPenaltyRequest?.(connection.slot);
    });
    connection.status = `Connected${connection.device.name ? ` (${connection.device.name})` : ''}`;
    await this.sendName(slotID);
  }

  async playAll(slotIDs: string[]) {
    await Promise.allSettled(slotIDs.map((slotID) => this.play(slotID, true)));
  }

  async stopAll(slotIDs: string[]) {
    await Promise.allSettled(slotIDs.map((slotID) => this.stop(slotID, true)));
  }

  async play(slotID: string, burst = false) {
    if (burst) await this.burst(slotID, Uint8Array.of(msg.play));
    await this.write(slotID, Uint8Array.of(msg.play));
  }

  async stop(slotID: string, burst = false) {
    if (burst) await this.burst(slotID, Uint8Array.of(msg.stop));
    await this.write(slotID, Uint8Array.of(msg.stop));
  }

  async penalty(slotID: string, seconds: number) {
    const millis = Math.max(0, seconds) * 1000;
    await this.write(slotID, packetWithMillis(msg.damage, millis));
  }

  async halfTime(slotIDs: string[], seconds: number) {
    const millis = Math.max(0, seconds) * 1000;
    await Promise.allSettled(slotIDs.map((slotID) => this.write(slotID, packetWithMillis(msg.halfTime, millis))));
  }

  async gameOver(slotIDs: string[], own: number, opponent: number) {
    await Promise.allSettled(slotIDs.map((slotID) => this.write(slotID, Uint8Array.of(msg.gameOver, own, opponent))));
  }

  async score(slotID: string, own: number, opponent: number) {
    await this.write(slotID, Uint8Array.of(msg.setScore, own, opponent));
  }

  private async sendName(slotID: string) {
    const connection = this.require(slotID);
    const chars = connection.slot.label.padEnd(2, ' ').slice(0, 2);
    await this.write(slotID, Uint8Array.of(msg.setName, chars.charCodeAt(0), chars.charCodeAt(1)));
  }

  private async burst(slotID: string, packet: Uint8Array) {
    for (let index = 0; index < 3; index += 1) {
      await this.write(slotID, packet, true);
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
  }

  private async write(slotID: string, packet: Uint8Array, withoutResponse = false) {
    const connection = this.require(slotID);
    if (!connection.tx) throw new Error(`${connection.slot.label} is not connected`);
    if (withoutResponse && connection.tx.writeValueWithoutResponse) {
      await connection.tx.writeValueWithoutResponse(packet);
    } else {
      await connection.tx.writeValue(packet);
    }
  }

  private require(slotID: string): RobotConnection {
    const connection = this.connections.get(slotID);
    if (!connection) throw new Error(`Unknown robot slot ${slotID}`);
    return connection;
  }
}

function packetWithMillis(id: number, millis: number): Uint8Array {
  return Uint8Array.of(id, (millis >>> 24) & 255, (millis >>> 16) & 255, (millis >>> 8) & 255, millis & 255);
}
