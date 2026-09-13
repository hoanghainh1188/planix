/// <reference types="vite/client" />

/**
 * Import CSS chỉ để lấy tác dụng phụ (Vite gom vào bundle). TypeScript không biết `.css`
 * là gì nếu không khai báo, và `verbatimModuleSyntax` không cho bỏ qua im lặng.
 */
declare module '*.css';
