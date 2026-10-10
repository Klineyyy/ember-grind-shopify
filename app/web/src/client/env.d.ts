/// <reference types="vite/client" />
import type { ReactNode } from 'react';

// App Bridge's <s-app-nav> is typed for the DOM but not for React JSX.
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      's-app-nav': { children?: ReactNode };
    }
  }
}
