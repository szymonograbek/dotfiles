export type TerminalSurfaceId = string;

export type ProcessCommand = {
	readonly executable: string;
	readonly args: readonly string[];
	readonly env?: Readonly<Record<string, string>>;
};

export interface TerminalHost {
	createSurface(
		request: { cwd: string; label: string; focus: boolean },
		signal?: AbortSignal,
	): Promise<TerminalSurfaceId>;
	start(surfaceId: TerminalSurfaceId, command: ProcessCommand, signal?: AbortSignal): Promise<void>;
	focus(surfaceId: TerminalSurfaceId, signal?: AbortSignal): Promise<void>;
	close(surfaceId: TerminalSurfaceId | undefined): Promise<void>;
	closeAll(): Promise<void>;
	isOpen(surfaceId: TerminalSurfaceId, signal?: AbortSignal): Promise<boolean>;
}
