/**
 * room-provisioner.ts — R-C-2 provision a task room with title projection.
 *
 * Orchestrates: agora.getTask(taskId) → buildRoomName(title, taskId) →
 * client.createRoom({ name }). Returns the created room + final name.
 *
 * §1 boundary: this adapter module knows matrix room semantics (room name
 * rules) but not agora Core business rules. The threadKey ↔ roomId mapping
 * stays in thread-registry (opaque to agora central).
 */

import { buildRoomName } from './room-name.js';

export interface RoomProvisionerClient {
  createRoom(options: { name: string }): Promise<{ roomId: string }>;
}

export interface RoomProvisionerAgora {
  getTask(taskId: string): Promise<{ id: string; title: string }>;
}

export interface ProvisionTaskRoomOptions {
  client: RoomProvisionerClient;
  agora: RoomProvisionerAgora;
  taskId: string;
}

export interface ProvisionTaskRoomResult {
  roomId: string;
  roomName: string;
}

export async function provisionTaskRoom(
  options: ProvisionTaskRoomOptions,
): Promise<ProvisionTaskRoomResult> {
  const { client, agora, taskId } = options;

  const task = await agora.getTask(taskId);
  if (!task) {
    throw new Error(`task not found: ${taskId}`);
  }

  const roomName = buildRoomName(task.title, task.id);
  const created = await client.createRoom({ name: roomName });
  return { roomId: created.roomId, roomName };
}
