import type { JSX } from 'react';
import './evm.css';

export interface EvmData {
  readonly baselineLabel: string;
  readonly statusDate: string;
  readonly bcws: number;
  readonly bcwp: number;
  readonly spi: number | null;
  readonly baselineTotalMd: number;
  readonly outsideBaselineMd: number;
}

interface Props {
  readonly evm: EvmData | null;
}

/**
 * Dải chỉ số EVM — SPI so với baseline.
 *
 * PM chốt 2026-09-13: chỉ SPI, chưa CPI. CPI cần chi phí thực tế, mà lấy số đó nghĩa là
 * thêm một ô nhập nữa cho lead — đúng thứ §10.5 đang cố giảm.
 *
 * Không có baseline thì KHÔNG hiện dải này. Hiện "SPI —" trông như tool hỏng; nói thẳng
 * là chưa chốt baseline thì PM biết phải làm gì.
 */
export function EvmStrip({ evm }: Props): JSX.Element | null {
  if (evm === null) {
    return (
      <div className="evm evm--empty">
        <span className="evm__hint">
          No baseline yet — close a period to start tracking schedule performance.
        </span>
      </div>
    );
  }

  const { spi } = evm;
  // Ngưỡng 0,95 / 1,05: dưới là chậm, trên là nhanh, giữa coi như đúng kế hoạch. Sai số
  // nhỏ hơn thế là nhiễu của phép làm tròn %, không phải tín hiệu.
  const tone = spi === null ? 'unknown' : spi < 0.95 ? 'behind' : spi > 1.05 ? 'ahead' : 'ontrack';

  return (
    <div className="evm" data-tone={tone}>
      <span className="evm__spi">
        <span className="evm__label">SPI</span>
        <strong className="evm__value">{spi === null ? '—' : spi.toFixed(2)}</strong>
        <span className="evm__word">
          {spi === null
            ? 'nothing scheduled yet'
            : tone === 'behind'
              ? 'behind plan'
              : tone === 'ahead'
                ? 'ahead of plan'
                : 'on plan'}
        </span>
      </span>

      <span className="evm__pair">
        <span className="evm__label">Planned</span>
        <span className="evm__num">{evm.bcws}</span>
        <span className="evm__unit">MD</span>
      </span>
      <span className="evm__pair">
        <span className="evm__label">Earned</span>
        <span className="evm__num">{evm.bcwp}</span>
        <span className="evm__unit">MD</span>
      </span>
      <span className="evm__pair">
        <span className="evm__label">Baseline</span>
        <span className="evm__num">{evm.baselineTotalMd}</span>
        <span className="evm__unit">MD</span>
      </span>

      {evm.outsideBaselineMd > 0 ? (
        <span
          className="evm__creep"
          title="Work added after the baseline was taken. It counts toward neither planned nor earned value."
        >
          +{evm.outsideBaselineMd} MD outside baseline
        </span>
      ) : null}

      <span className="evm__meta">
        {evm.baselineLabel} · as of {evm.statusDate}
      </span>
    </div>
  );
}
