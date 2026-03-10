import Foundation
import OpenClawKit
import Testing
@testable import OpenClawChatUI

@Suite struct ChatMessageMergingTests {
    @Test func mergeToolResultsPreservesImageBlocks() {
        let assistant = OpenClawChatMessage(
            role: "assistant",
            content: [
                OpenClawChatMessageContent(
                    type: "toolCall",
                    text: nil,
                    data: nil,
                    thinking: nil,
                    thinkingSignature: nil,
                    mimeType: nil,
                    fileName: nil,
                    content: nil,
                    id: "tool-1",
                    name: "browser",
                    arguments: AnyCodable(["action": "screenshot"])),
            ],
            timestamp: 1)
        let toolResult = OpenClawChatMessage(
            role: "toolResult",
            content: [
                OpenClawChatMessageContent(
                    type: "text",
                    text: "MEDIA:/tmp/screenshot.png",
                    data: nil,
                    thinking: nil,
                    thinkingSignature: nil,
                    mimeType: nil,
                    fileName: nil,
                    content: nil),
                OpenClawChatMessageContent(
                    type: "image",
                    text: nil,
                    data: "aGVsbG8=",
                    thinking: nil,
                    thinkingSignature: nil,
                    mimeType: "image/png",
                    fileName: "screenshot.png",
                    content: nil),
            ],
            timestamp: 2,
            toolCallId: "tool-1",
            toolName: "browser")

        let merged = ChatMessageMerging.mergeToolResults(
            in: [assistant, toolResult],
            isToolResultMessage: { $0.role.lowercased() == "toolresult" || $0.role.lowercased() == "tool_result" },
            toolCallIds: { message in
                Set(message.content.compactMap { $0.id })
            },
            toolName: { $0.toolName })

        #expect(merged.count == 1)
        #expect(merged[0].content.contains(where: { $0.type == "tool_result" && $0.text == "MEDIA:/tmp/screenshot.png" }))
        let image = try #require(merged[0].content.first(where: { $0.type == "image" }))
        #expect(image.data == "aGVsbG8=")
        #expect(image.mimeType == "image/png")
        #expect(image.fileName == "screenshot.png")
    }

    @Test func decodesTopLevelImageDataField() throws {
        let payload = AnyCodable([
            "role": "toolResult",
            "content": [[
                "type": "image",
                "data": "aGVsbG8=",
                "mimeType": "image/png",
                "fileName": "screenshot.png",
            ]],
        ])

        let decoded = try ChatPayloadDecoding.decode(payload, as: OpenClawChatMessage.self)
        let image = try #require(decoded.content.first)
        #expect(image.type == "image")
        #expect(image.data == "aGVsbG8=")
        #expect(image.mimeType == "image/png")
    }
}
