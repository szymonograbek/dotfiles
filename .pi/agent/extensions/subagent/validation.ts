import { Type } from "typebox";
import { Check } from "typebox/value";

const UnknownRecord = Type.Record(Type.String(), Type.Unknown());
const Content = Type.Array(Type.Object({
	type: Type.String(),
	text: Type.Optional(Type.String()),
}));
const Message = Type.Object({
	role: Type.String(),
	content: Type.Unknown(),
});

export function isRecord(value: unknown): value is Record<string, unknown> {
	return Check(UnknownRecord, value);
}

export function contentText(content: unknown): string {
	if (!Check(Content, content)) return "";
	return content.flatMap((item) => {
		if (item.type !== "text" || item.text === undefined) return [];
		const text = item.text.trim();
		return text === "" ? [] : [text];
	}).join("\n");
}

export function finalResponseFromMessages(messages: readonly unknown[]): string {
	let latestToolText = "";
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (!Check(Message, message)) continue;
		const text = contentText(message.content);
		if (text === "") continue;
		if (message.role === "assistant") return text;
		if (message.role === "toolResult" && latestToolText === "") latestToolText = text;
	}
	return latestToolText;
}
