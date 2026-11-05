import React, { useEffect, useRef, useState, type ReactNode } from "react";
import ErrorBoundary from "@docusaurus/ErrorBoundary";
import { ErrorBoundaryErrorMessageFallback } from "@docusaurus/theme-common";
import { MermaidContainerClassName, useMermaidConfig } from "@docusaurus/theme-mermaid/client";

import styles from "./styles.module.css";

import type { Props } from "@theme/Mermaid";
import type { MermaidConfig, RenderResult } from "mermaid";

// Khác bản gốc của Docusaurus: mermaid là singleton toàn cục (initialize + render dùng chung cấu hình), nên các
// sơ đồ render chồng nhau khi tải trang ở dark mode làm mất sơ đồ cuối trang. Ở đây mọi lần render chạy tuần tự.
let queue: Promise<unknown> = Promise.resolve();

function renderQueued(id: string, text: string, config: MermaidConfig): Promise<RenderResult> {
  const run = async (): Promise<RenderResult> => {
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize(config);
    try {
      return await mermaid.render(id, text);
    } catch (e) {
      document.querySelector(`#d${id}`)?.remove(); // mermaid để lại phần tử lỗi trong DOM
      throw e;
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

function MermaidRenderer({ value }: Props): ReactNode {
  const config = useMermaidConfig() as MermaidConfig;
  const [id] = useState(() => `mermaid-svg-${Math.round(Math.random() * 10000000)}`);
  const [result, setResult] = useState<RenderResult | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stale = false;
    renderQueued(id, value, config)
      .then((r) => !stale && setResult(r))
      .catch((e: unknown) => {
        // Ném trong setState để ErrorBoundary phía trên hiển thị lỗi cú pháp của sơ đồ
        if (!stale) {
          setResult(() => {
            throw e;
          });
        }
      });
    return () => {
      stale = true;
    };
  }, [id, value, config]);

  useEffect(() => {
    if (result && ref.current) result.bindFunctions?.(ref.current);
  }, [result]);

  return result === null ? null : (
    <div
      ref={ref}
      className={`${MermaidContainerClassName} ${styles.container}`}
      dangerouslySetInnerHTML={{ __html: result.svg }}
    />
  );
}

export default function Mermaid(props: Props): ReactNode {
  return (
    <ErrorBoundary fallback={(params) => <ErrorBoundaryErrorMessageFallback {...params} />}>
      <MermaidRenderer {...props} />
    </ErrorBoundary>
  );
}
