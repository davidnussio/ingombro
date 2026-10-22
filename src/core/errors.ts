import { Predicate, Schema } from "effect";

export class PathNotFound extends Schema.TaggedError<PathNotFound>()("PathNotFound", {
	path: Schema.String,
}) {
	override get message() {
		return `${this.path}: not found`;
	}
}

export class NotADirectory extends Schema.TaggedError<NotADirectory>()("NotADirectory", {
	path: Schema.String,
}) {
	override get message() {
		return `${this.path}: not a directory`;
	}
}

/** Deleting (trash or permanent) a path failed. */
export class DeleteError extends Schema.TaggedError<DeleteError>()("DeleteError", {
	path: Schema.String,
	cause: Schema.Defect(),
}) {
	override get message() {
		return causeMessage(this.cause);
	}
}

export class EnvsecError extends Schema.TaggedError<EnvsecError>()("EnvsecError", {
	reason: Schema.String,
	cause: Schema.optional(Schema.Defect()),
}) {
	override get message() {
		return this.cause === undefined ? this.reason : `${this.reason}: ${causeMessage(this.cause)}`;
	}
}

export function causeMessage(cause: unknown): string {
	if (Predicate.hasProperty(cause, "message")) return String(cause.message);
	return String(cause);
}

/** An external command (open, xdg-open, osascript) failed or exited non-zero. */
export class CommandError extends Schema.TaggedError<CommandError>()("CommandError", {
	command: Schema.String,
	cause: Schema.Defect(),
}) {
	override get message() {
		return `${this.command}: ${causeMessage(this.cause)}`;
	}
}
