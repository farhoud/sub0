// @sigil implements design/task-store.sigil TaskStore
//
// Layout under <project root>/.agents/subzero/:
//   .gitignore            ignores everything in the store folder
//   index.jsonl           append-only; the latest line per task wins
//   tasks/<id>/task.json  frozen agent definition, brief and, once started, the launch spec
//   tasks/<id>/events.jsonl
//   tasks/<id>/turns/1.json  the exact result the parent received
//   tasks/<id>/            also holds the driver files of the task, which the store never writes
//   sessions/             child sessions
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { AgentDefinition } from '../config/agent-config.js';
import type { DomainEvent, LaunchSpec, Result, ResultStatus } from '../core/types.js';

export type TaskStatus = 'running' | ResultStatus | 'abandoned';

export interface OwnerProcess {
  pid: number;
  startTime: string;
}

export interface IndexLine {
  taskId: string;
  agent: string;
  status: TaskStatus;
  parentSessionId?: string;
  /** The child session id, which is the task id. */
  childSession: string;
  sessionFile?: string;
  createdAt: string;
  updatedAt: string;
  /** Written on the first line of a task only. */
  owner?: OwnerProcess;
}

export interface TaskJson {
  taskId: string;
  agent: AgentDefinition;
  brief: string;
  parentSessionId?: string;
  createdAt: string;
  launchSpec?: LaunchSpec;
}

/** One task as a reader sees it: the latest index line merged with the record. */
export interface TaskView {
  taskId: string;
  agent: string;
  status: TaskStatus;
  parentSessionId?: string;
  createdAt: string;
  updatedAt: string;
  sessionFile?: string;
  owner?: OwnerProcess;
}

export interface TaskRecord extends TaskView {
  task: TaskJson | null;
  result: Result | null;
}

/**
 * Reports when a process started, without signalling it: its start time while it
 * is alive, null when there is no such process, and undefined when it cannot tell.
 */
export interface ProcessProbe {
  startTime(pid: number): string | null | undefined;
}

export const psProbe: ProcessProbe = {
  startTime(pid: number): string | null | undefined {
    // On Linux the start time in ticks since boot is stable; lstart moves when the
    // wall clock is stepped.
    if (process.platform === 'linux' && existsSync('/proc/self/stat')) {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        return fields[19] ?? undefined;
      } catch (err) {
        return (err as NodeJS.ErrnoException).code === 'ENOENT' ? null : undefined;
      }
    }
    try {
      // A fixed locale and zone, so every process prints the same start time.
      const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
        encoding: 'utf8',
        env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return out === '' ? null : out;
    } catch (err) {
      // ps exits 1 when the process does not exist; anything else is unknown.
      return (err as { status?: number }).status === 1 ? null : undefined;
    }
  },
};

export interface TaskStoreOptions {
  warn?: (message: string) => void;
  probe?: ProcessProbe;
  /** The process recorded as owner of new tasks. Defaults to this process. */
  owner?: OwnerProcess;
}

/**
 * The writer side of a task record. Only TaskCore holds one; every other component
 * reads through TaskStore.
 */
export interface TaskRecordWriter {
  readonly sessionsFolder: string;
  /** The folder where the child driver keeps its own files of a task. */
  driverFilesFolder(taskId: string): string;
  createTaskRecord(task: TaskJson): void;
  writeLaunchSpec(taskId: string, spec: LaunchSpec): void;
  appendEvent(taskId: string, event: DomainEvent): void;
  writeResult(taskId: string, result: Result, extra?: { sessionFile?: string }): void;
  exists(taskId: string): boolean;
}

export class TaskStore implements TaskRecordWriter {
  readonly storeFolder: string;
  readonly sessionsFolder: string;
  readonly indexPath: string;
  private readonly warn: (message: string) => void;
  private readonly probe: ProcessProbe;
  private ownerProcess: OwnerProcess | undefined;

  /** The project root comes from the caller; TaskStore resolves none of its own. */
  constructor(projectRoot: string, options: TaskStoreOptions = {}) {
    this.storeFolder = path.join(projectRoot, '.agents', 'subzero');
    this.sessionsFolder = path.join(this.storeFolder, 'sessions');
    this.indexPath = path.join(this.storeFolder, 'index.jsonl');
    this.warn = options.warn ?? ((m) => process.stderr.write(`subzero: ${m}\n`));
    this.probe = options.probe ?? psProbe;
    this.ownerProcess = options.owner;
  }

  taskDir(taskId: string): string {
    return path.join(this.storeFolder, 'tasks', taskId);
  }

  /** The driver files of a task sit in its task folder, beside the task record. */
  driverFilesFolder(taskId: string): string {
    return this.taskDir(taskId);
  }

  private get owner(): OwnerProcess {
    if (this.ownerProcess === undefined) {
      this.ownerProcess = { pid: process.pid, startTime: this.probe.startTime(process.pid) ?? 'unknown' };
    }
    return this.ownerProcess;
  }

  // ---- writes -------------------------------------------------------------

  /** Create the store folder, owner-only, with a .gitignore that ignores it all. */
  private ensureStoreFolder(): void {
    if (!existsSync(this.storeFolder)) {
      mkdirSync(this.storeFolder, { recursive: true, mode: 0o700 });
      chmodSync(this.storeFolder, 0o700);
    }
    const ignore = path.join(this.storeFolder, '.gitignore');
    if (!existsSync(ignore)) writeFileSync(ignore, '*\n', { flag: 'wx' });
  }

  exists(taskId: string): boolean {
    return existsSync(this.taskDir(taskId));
  }

  createTaskRecord(task: TaskJson): void {
    this.ensureStoreFolder();
    const dir = this.taskDir(task.taskId);
    mkdirSync(path.join(dir, 'turns'), { recursive: true, mode: 0o700 });
    writeAtomic(path.join(dir, 'task.json'), task);
    this.appendIndex({
      taskId: task.taskId,
      agent: task.agent.name,
      status: 'running',
      ...(task.parentSessionId !== undefined ? { parentSessionId: task.parentSessionId } : {}),
      childSession: task.taskId,
      createdAt: task.createdAt,
      updatedAt: task.createdAt,
      owner: this.owner,
    });
  }

  writeLaunchSpec(taskId: string, spec: LaunchSpec): void {
    const file = path.join(this.taskDir(taskId), 'task.json');
    const task = readJson<TaskJson>(file);
    if (task === null) throw new Error(`no task record for ${taskId}`);
    writeAtomic(file, { ...task, launchSpec: spec });
  }

  appendEvent(taskId: string, event: DomainEvent): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n';
    appendFileSync(path.join(this.taskDir(taskId), 'events.jsonl'), line, { mode: 0o600 });
  }

  /** Write the result in one step, and only then the index line that gives its status. */
  writeResult(taskId: string, result: Result, extra: { sessionFile?: string } = {}): void {
    writeAtomic(path.join(this.taskDir(taskId), 'turns', '1.json'), result);
    const first = this.readLatest().get(taskId);
    this.appendIndex({
      taskId,
      agent: result.agent,
      status: result.status,
      ...(first?.parentSessionId !== undefined ? { parentSessionId: first.parentSessionId } : {}),
      childSession: taskId,
      ...(extra.sessionFile !== undefined ? { sessionFile: extra.sessionFile } : {}),
      createdAt: first?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  /** One line, one write: O_APPEND keeps two processes from interleaving a line. */
  private appendIndex(line: IndexLine): void {
    this.ensureStoreFolder();
    appendFileSync(this.indexPath, JSON.stringify(line) + '\n', { mode: 0o600 });
  }

  // ---- reads --------------------------------------------------------------

  /** The latest line per task, with the owner and creation time of its first line. */
  readLatest(): Map<string, IndexLine> {
    const latest = new Map<string, IndexLine>();
    let text: string;
    try {
      text = readFileSync(this.indexPath, 'utf8');
    } catch {
      return latest;
    }
    const lines = text.split('\n');
    lines.forEach((raw, i) => {
      if (raw.trim() === '') return;
      let line: IndexLine;
      try {
        line = JSON.parse(raw) as IndexLine;
        if (typeof line.taskId !== 'string' || typeof line.status !== 'string') throw new Error('shape');
      } catch {
        this.warn(`skipping corrupt line ${i + 1} of ${this.indexPath}`);
        return;
      }
      const earlier = latest.get(line.taskId);
      latest.set(line.taskId, {
        ...line,
        owner: earlier?.owner ?? line.owner,
        createdAt: earlier?.createdAt ?? line.createdAt,
        parentSessionId: line.parentSessionId ?? earlier?.parentSessionId,
        sessionFile: line.sessionFile ?? earlier?.sessionFile,
      });
    });
    return latest;
  }

  readResult(taskId: string): Result | null {
    return readJson<Result>(path.join(this.taskDir(taskId), 'turns', '1.json'));
  }

  readTaskJson(taskId: string): TaskJson | null {
    return readJson<TaskJson>(path.join(this.taskDir(taskId), 'task.json'));
  }

  /** A stored result outranks whatever the latest index line says. */
  private view(line: IndexLine, result: Result | null): TaskView {
    return {
      taskId: line.taskId,
      agent: line.agent,
      status: result?.status ?? line.status,
      ...(line.parentSessionId !== undefined ? { parentSessionId: line.parentSessionId } : {}),
      createdAt: line.createdAt,
      updatedAt: line.updatedAt,
      ...(line.sessionFile !== undefined ? { sessionFile: line.sessionFile } : {}),
      ...(line.owner !== undefined ? { owner: line.owner } : {}),
    };
  }

  readTask(taskId: string): TaskRecord | null {
    const line = this.readLatest().get(taskId);
    if (line === undefined) return null;
    const result = this.readResult(taskId);
    const view = this.view(line, result);
    const sessionFile = view.sessionFile ?? this.findSessionFile(taskId);
    return { ...view, ...(sessionFile !== undefined ? { sessionFile } : {}), task: this.readTaskJson(taskId), result };
  }

  /** The child session file of a task in the sessions folder; its id is the task id. */
  findSessionFile(taskId: string): string | undefined {
    try {
      const name = readdirSync(this.sessionsFolder).find((f) => f.endsWith(`_${taskId}.jsonl`) || f === `${taskId}.jsonl`);
      return name === undefined ? undefined : path.join(this.sessionsFolder, name);
    } catch {
      return undefined;
    }
  }

  /** Every task, or the tasks of one parent session id. */
  list(parentSessionId?: string): TaskView[] {
    const views: TaskView[] = [];
    for (const line of this.readLatest().values()) {
      if (parentSessionId !== undefined && line.parentSessionId !== parentSessionId) continue;
      views.push(this.view(line, line.status === 'running' || line.status === 'abandoned' ? this.readResult(line.taskId) : null));
    }
    return views;
  }

  /**
   * Mark abandoned each task whose latest line says running and whose owner process
   * is gone or has another start time. Signals no process. Returns the marked ids.
   */
  sweep(): string[] {
    const marked: string[] = [];
    // A probe that cannot even read this process cannot tell anyone is gone.
    if (typeof this.probe.startTime(process.pid) !== 'string') return marked;
    for (const line of this.readLatest().values()) {
      if (line.status !== 'running' || line.owner === undefined) continue;
      const startTime = this.probe.startTime(line.owner.pid);
      // A probe that cannot tell never marks a task.
      if (startTime === undefined) continue;
      if (startTime !== null && (startTime === line.owner.startTime || line.owner.startTime === 'unknown')) continue;

      // Read again just before appending: the owner may have settled meanwhile.
      const now = this.readLatest().get(line.taskId);
      if (now === undefined || now.status !== 'running') continue;
      if (this.readResult(line.taskId) !== null) continue;
      this.appendIndex({
        taskId: line.taskId,
        agent: line.agent,
        status: 'abandoned',
        ...(now.parentSessionId !== undefined ? { parentSessionId: now.parentSessionId } : {}),
        childSession: line.taskId,
        ...sessionField(now.sessionFile ?? this.findSessionFile(line.taskId)),
        createdAt: now.createdAt,
        updatedAt: new Date().toISOString(),
      });
      marked.push(line.taskId);
    }
    return marked;
  }
}

function sessionField(sessionFile: string | undefined): { sessionFile?: string } {
  return sessionFile !== undefined ? { sessionFile } : {};
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Write to a temporary file and rename it, so a reader never sees part of it. */
function writeAtomic(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, file);
}
