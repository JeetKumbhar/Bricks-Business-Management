import { createContext, useContext } from "react";

export const CustomerContext = createContext(null);

export function useCustomerStore() {
  const context = useContext(CustomerContext);
  if (!context) throw new Error("useCustomerStore must be used inside <CustomerProvider>");
  return context;
}
