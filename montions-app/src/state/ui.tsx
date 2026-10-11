import { createContext, useContext } from 'react';

export interface UiApi {
  /** Open the wallet sheet; `onConnected` runs once a wallet connects from it. */
  openWallet: (onConnected?: (address: string) => void) => void;
  openTickets: () => void;
  overlayOpen: boolean;
  ticketCount: number;
}

export const UiCtx = createContext<UiApi>({
  openWallet: () => {},
  openTickets: () => {},
  overlayOpen: false,
  ticketCount: 0,
});
export const useUi = () => useContext(UiCtx);
