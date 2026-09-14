/**
 * Hình dạng kết quả chung của mọi tool MCP — SPEC.md §12.4.
 *
 * *"Tool đọc KHÔNG trả về text đã diễn giải. Chỉ JSON có cấu trúc."*
 *
 * Nên `structuredContent` là phần thật, còn `content` chỉ là bản in ra nguyên văn cùng dữ
 * liệu đó, dành cho client chưa đọc được `structuredContent`. Không có câu văn nào do tool
 * tự đặt ra — phần `note` trong vài tool ghi là ngoại lệ có chủ đích: nó nói cho AI biết
 * thao tác CHƯA xảy ra, và đó là thông tin, không phải diễn giải.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Db } from '@planix/core/db/migrate.js';
import type { McpPrincipal } from '@planix/core/db/repo/mcp-token-repo.js';

export type McpToolResult = CallToolResult;

export interface McpContext {
  readonly db: Db;
  /** Đường dẫn file DB — worker lập lịch cần mở kết nối riêng (§7.14). */
  readonly dbPath: string;
  readonly principal: McpPrincipal;
  /** Thời điểm của request. Truyền vào chứ không đọc đồng hồ trong logic (N2). */
  readonly now: string;
}

/** Kết quả tool: JSON có cấu trúc, cộng bản in ra cho client chưa đọc structured. */
export function jsonResult(data: unknown): McpToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: { result: data },
  };
}

/** Lỗi tool: MCP muốn `isError` trong kết quả, không phải một exception ném ra ngoài. */
export function errorResult(message: string): McpToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}
