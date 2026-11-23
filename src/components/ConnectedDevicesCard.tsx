import React, { useState } from 'react';
import {
  Clock,
  Laptop,
  Loader2,
  LogOut,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import type { ConnectedDevice } from '../types/zapei';

interface ConnectedDevicesCardProps {
  devices: ConnectedDevice[];
  currentDeviceId: string;
  onDisconnectDevice: (device: ConnectedDevice) => Promise<void>;
}

export const ConnectedDevicesCard: React.FC<ConnectedDevicesCardProps> = ({
  devices,
  currentDeviceId,
  onDisconnectDevice,
}) => {
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);
  const [confirmSelfId, setConfirmSelfId] = useState<string | null>(null);

  const handleDisconnect = async (device: ConnectedDevice) => {
    if (device.deviceId === currentDeviceId && confirmSelfId !== device.deviceId) {
      setConfirmSelfId(device.deviceId);
      return;
    }
    setBusyDeviceId(device.deviceId);
    try {
      await onDisconnectDevice(device);
    } finally {
      setBusyDeviceId(null);
      setConfirmSelfId(null);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-[#0E7A34]">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Aparelhos Conectados</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Gerencie o Aparelho Principal e os demais dispositivos vinculados à sua conta. Novos acessos exigem aprovação por QR Code ou código de 6 dígitos.
            </p>
          </div>
        </div>
        <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
          {devices.length} {devices.length === 1 ? 'aparelho ativo' : 'aparelhos ativos'}
        </span>
      </div>

      {devices.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-xs text-slate-500">
          Carregando lista de aparelhos conectados...
        </div>
      ) : (
        <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-slate-50/40">
          {devices.map((device) => {
            const isCurrent = device.deviceId === currentDeviceId;
            const isMobile = /Android|iPhone|iPad|iOS/i.test(
              `${device.deviceName} ${device.platform}`
            );
            const isBusy = busyDeviceId === device.deviceId;
            const awaitingSelfConfirm = confirmSelfId === device.deviceId;

            return (
              <div
                key={device.deviceId}
                className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                      device.primary
                        ? 'bg-[#0E7A34] text-white'
                        : 'bg-white text-slate-700 ring-1 ring-slate-200'
                    }`}
                  >
                    {isMobile ? (
                      <Smartphone className="h-5 w-5" />
                    ) : (
                      <Laptop className="h-5 w-5" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-sm font-bold text-slate-900">
                        {device.deviceName}
                      </p>
                      {device.primary && (
                        <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-[#0E7A34]">
                          Aparelho Principal
                        </span>
                      )}
                      {isCurrent && (
                        <span className="rounded-md bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                          Este aparelho
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Conectado em {device.createdAtLabel}
                      </span>
                      {device.lastActiveAtLabel !== device.createdAtLabel && (
                        <span>Último acesso: {device.lastActiveAtLabel}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {awaitingSelfConfirm && (
                    <button
                      type="button"
                      onClick={() => setConfirmSelfId(null)}
                      className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      Cancelar
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void handleDisconnect(device)}
                    className={`inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-bold transition disabled:opacity-50 ${
                      awaitingSelfConfirm
                        ? 'bg-red-600 text-white hover:bg-red-700'
                        : 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                    }`}
                  >
                    {isBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <LogOut className="h-3.5 w-3.5" />
                    )}
                    {awaitingSelfConfirm ? 'Confirmar saída' : 'Desconectar'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
