import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Mục tiêu của file này: biến nguyên tắc văn xuôi trong SPEC.md §2 và CLAUDE.md §3
 * thành gate chạy được. Rule nào chỉ nhắc được bằng lời thì ghi chú, không giả vờ chặn.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.d.ts',
      'packages/server/**',
      'packages/web/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // CLAUDE.md §3 — không `any`; `as` phải có lý do viết thành comment.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
    },
  },

  {
    // N2 — Deterministic. Engine không được phụ thuộc môi trường chạy.
    // Đây là điều kiện của M2: cùng input ra cùng output, byte-for-byte.
    files: ['packages/core/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message:
            'N2: Math.random() bi cam trong engine. Moi lua chon phai co tie-break co dinh (SPEC.md 7.4).',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'N2: Date.now() bi cam trong engine. Thoi diem phai truyen vao nhu tham so.',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            'N2: new Date() khong tham so doc dong ho he thong. Truyen DateOnly vao thay vi doc gio.',
        },
      ],
      // CLAUDE.md §3 — core không được import ngược lên server/web.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@planix/server', '@planix/server/*', '@planix/web', '@planix/web/*'],
              message:
                'packages/core khong duoc phu thuoc server/web (SPEC.md 3.3). Can import nguoc nghia la thiet ke sai.',
            },
          ],
        },
      ],
    },
  },

  {
    // Test được phép dùng Date để dựng dữ liệu; fixture golden vẫn phải tĩnh.
    files: ['**/tests/**/*.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  {
    // File config ở gốc repo không thuộc tsconfig nào, nên typed-lint không parse được.
    // Chúng là cấu hình build, không phải code sản phẩm — tắt luật cần kiểu, giữ luật cú pháp.
    files: ['*.mjs', '*.js', '*.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
