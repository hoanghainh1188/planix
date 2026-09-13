/**
 * Endpoint MCP — SPEC.md §12.4.
 *
 * *"Endpoint bảo vệ bằng bearer token riêng, không dùng session cookie."* Hai lý do, và
 * cả hai đều quan trọng hơn vẻ ngoài của nó:
 *
 *   - Cookie tự động đi kèm mọi request trình duyệt gửi tới origin này. Nếu `/mcp` nhận
 *     cookie thì một trang bất kỳ có thể khiến trình duyệt của PM gọi tool ghi — CSRF,
 *     trên đúng cái endpoint được phép sửa cả cây WBS. Bearer token thì không tự đi kèm.
 *   - Phiên hết hạn sau 7 ngày (§13.3) và gắn với một người đang ngồi trước máy. Tiến
 *     trình AI thì không đăng nhập lại được.
 *
 * Do đó ở đây KHÔNG đọc cookie, kể cả khi có. Một request mang cookie hợp lệ mà không
 * mang bearer token vẫn bị từ chối.
 *
 * Chế độ stateless: không `sessionIdGenerator`, mỗi request dựng một transport mới rồi
 * bỏ. §13.1 chạy một tiến trình duy nhất, nhưng giữ phiên MCP trong RAM thì mỗi lần
 * triển khai lại là mọi client đang nối bị rơi — và chúng không có gì để nối lại. Không
 * tool nào ở đây cần trạng thái giữa hai lời gọi, nên cái giá đó không đáng.
 */

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Db } from '@planix/core/db/migrate.js';
import { resolveMcpToken, type McpPrincipal } from '@planix/core/db/repo/mcp-token-repo.js';
import { createMcpServer } from '../mcp/server.js';

/** Rút token khỏi `Authorization: Bearer <token>`. `null` nếu header thiếu hay sai dạng. */
export function bearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Bearer (.+)$/.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * Xử lý một request MCP đã qua xác thực.
 *
 * Mỗi lời gọi có `McpServer` riêng vì `ctx` mang theo principal — dùng chung một server
 * cho mọi người thì tool sẽ đóng trên principal của người gọi ĐẦU TIÊN, và mọi người sau
 * đó đọc dữ liệu bằng quyền của người đó. Dựng server mới là rẻ (chỉ đăng ký tool), và
 * nhầm ở đây là rò dữ liệu chứ không phải chậm.
 */
export async function handleMcpRequest(params: {
  readonly db: Db;
  readonly principal: McpPrincipal;
  readonly now: string;
  readonly request: Request;
}): Promise<Response> {
  const server = createMcpServer({
    db: params.db,
    principal: params.principal,
    now: params.now,
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    // `enableJsonResponse`: một response JSON cho mỗi request, không mở SSE. Tool ở đây
    // trả xong là xong, không có gì để đẩy dần.
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(params.request);
  } finally {
    // Đóng cả hai kể cả khi ném: mỗi request một transport, không đóng là rò từng cái một.
    await transport.close();
    await server.close();
  }
}

export interface McpAuthResult {
  readonly principal: McpPrincipal | null;
}

/** Tra token. Tách khỏi `handleMcpRequest` để route ghi được `userId` vào nhật ký. */
export function authenticateMcp(db: Db, header: string | undefined, now: string): McpAuthResult {
  const token = bearerToken(header);
  if (token === null) return { principal: null };
  return { principal: resolveMcpToken(db, token, now) };
}
