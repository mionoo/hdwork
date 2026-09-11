import { useEffect, useState } from "react";
import { API_URL } from "@/config/api";
export type NetworkHealth = { agent: boolean | null; vpn: boolean | null; vpnHost: string };
// One poller per Network Tools page, not one per terminal/tab.
export function useNetworkHealth(token: string | null, active: boolean): NetworkHealth {
  const [agent, setAgent] = useState<boolean | null>(null);
  const [vpn, setVpn] = useState<boolean | null>(null);
  const [vpnHost, setVpnHost] = useState("-");
  useEffect(() => {
    if (!token || !active) return;
    let stopped = false;
    let checking = false;
    let lastCheck = 0;
    const request = async (path: string) => {
      const response = await fetch(
        API_URL + "/network/" + path,
        { headers: { Authorization: "Bearer " + token } },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.message);
      return body.data;
    };
    const check = async () => {
      if (stopped || document.hidden || checking || Date.now() - lastCheck < 15_000) return;
      checking = true;
      lastCheck = Date.now();
      try {
        const state = await request("status");
        if (stopped) return;
        setAgent(state.online);
        setVpnHost(state.vpn_health_host || "-");
        if (!state.online) return setVpn(null);
        const health = await request("vpn-health");
        if (!stopped) setVpn(Boolean(health.reachable));
      } catch {
        if (!stopped) {
          setAgent(false);
          setVpn(null);
        }
      } finally {
        checking = false;
      }
    };
    check();
    const timer = window.setInterval(check, 15_000);
    const visible = () => {
      if (!document.hidden) check();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [token, active]);

  return { agent, vpn, vpnHost };
}
