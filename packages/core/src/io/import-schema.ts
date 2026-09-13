/**
 * Hợp đồng import AI → Tool, SPEC.md §9.2.
 *
 * Dùng `strictObject`: trường lạ làm cả file bị từ chối. Đây không phải khó tính vô cớ —
 * §9.1 cấm AI gửi ngày tháng, tên người hay `wbs_code`. Nếu schema im lặng bỏ qua trường
 * thừa thì một payload có `start_date` sẽ import trót lọt và người đọc tưởng ngày đó
 * được tôn trọng, trong khi engine đã lờ đi. Sai kiểu đó khó phát hiện hơn là báo lỗi.
 */

import { z } from 'zod';

export const TaskInputSchema = z.strictObject({
  tmp_id: z.string().min(1),
  /** Cha nằm trong chính file này. */
  parent_tmp_id: z.string().min(1).nullable().optional(),
  /** Cha là task đã có trong DB (gắn vào cây sẵn có). */
  parent_uid: z.string().min(1).nullable().optional(),
  name: z.string().min(1),
  kind: z.enum(['summary', 'work', 'milestone']),
  effort_md: z.number().optional(),
  role: z.string().optional(),
  category: z.string().optional(),
  phase: z.string().optional(),
  module: z.string().optional(),
  priority: z.number().int().optional(),
  child_sequencing: z.enum(['parallel', 'sequential']).optional(),
});

export const DependencyInputSchema = z.strictObject({
  pred: z.string().min(1),
  succ: z.string().min(1),
  type: z.enum(['FS', 'SS', 'FF', 'SF']),
  lag_days: z.number().default(0),
});

export const ImportPayloadSchema = z
  .strictObject({
    version: z.literal('1.0'),
    project_code: z.string().min(1),
    mode: z.enum(['merge', 'replace-subtree']),
    root_uid: z.string().min(1).optional(),
    tasks: z.array(TaskInputSchema),
    dependencies: z.array(DependencyInputSchema).default([]),
  })
  .refine((p) => p.mode !== 'replace-subtree' || p.root_uid !== undefined, {
    message: 'root_uid is required when mode is "replace-subtree"',
    path: ['root_uid'],
  });

export type TaskInput = z.infer<typeof TaskInputSchema>;
export type DependencyInput = z.infer<typeof DependencyInputSchema>;
export type ImportPayload = z.infer<typeof ImportPayloadSchema>;
