import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <span className="flex size-7 items-center justify-center rounded-[3px] bg-[#0B0B0C] text-white">
            <svg viewBox="0 0 32 32" fill="none" aria-hidden className="size-5">
              <path d="M16 4C9.373 4 5 8.25 5 13.5h19.5c-.2-4.8-4.5-9.5-8.5-9.5z" fill="currentColor" fillOpacity="0.95" />
              <path d="M16 7c2.8 0 4.7 2.2 4.9 5H10.1C10.5 9.2 12.8 7 16 7z" fill="#d25611" />
              <path d="M4 14.5C4 13.67 4.67 13 5.5 13h22c.83 0 1.5.67 1.5 1.5v.5c0 .83-.67 1.5-1.5 1.5H5.5C4.67 16.5 4 15.83 4 15v-.5z" fill="currentColor" />
              <path d="M5.5 16h21v1.5H5.5z" fill="currentColor" fillOpacity="0.4" />
              <path d="M5 18c.3 5.2 4.8 9 11.5 9 4.8 0 8.5-2 10.2-5.2l-3.2-1.8c-1.2 2-3.8 3.5-7 3.5-4.5 0-7.4-2.5-7.8-5.5H5z" fill="currentColor" fillOpacity="0.9" />
              <path d="M16 27c3.8 0 7-1.3 8.7-3.5l1 1C23.8 27.2 20.2 29 16 29c-7.2 0-12-4.2-12.3-9.8H5c.3 4.8 4.7 7.8 11 7.8z" fill="currentColor" fillOpacity="0.25" />
            </svg>
          </span>
          <span className="font-semibold">EcoRouter</span>
        </>
      ),
    },
    links: [
      {
        text: 'Home',
        url: 'https://ecorouter.xyz/',
        external: true,
      },
      {
        text: 'GitHub',
        url: 'https://github.com/fozagtx/ecorouter',
        external: true,
      },
    ],
  };
}
