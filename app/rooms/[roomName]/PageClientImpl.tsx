'use client';

import React from 'react';
import { decodePassphrase } from '@/lib/client-utils';
import { DebugMode } from '@/lib/Debug';
import { KeyboardShortcuts } from '@/lib/KeyboardShortcuts';
import { RecordingIndicator } from '@/lib/RecordingIndicator';
import { SettingsMenu } from '@/lib/SettingsMenu';
import { ConnectionDetails } from '@/lib/types';
import {
  formatChatMessageLinks,
  LocalUserChoices,
  PreJoin,
  RoomContext,
  VideoConference,
} from '@livekit/components-react';
import {
  ExternalE2EEKeyProvider,
  RoomOptions,
  VideoCodec,
  VideoPresets,
  Room,
  DeviceUnsupportedError,
  RoomConnectOptions,
  RoomEvent,
  Track,
  TrackPublishDefaults,
  VideoCaptureOptions,
} from 'livekit-client';
import { useRouter } from 'next/navigation';
import { useSetupE2EE } from '@/lib/useSetupE2EE';
import { useLowCPUOptimizer } from '@/lib/usePerfomanceOptimiser';

const CONN_DETAILS_ENDPOINT =
  process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT ?? '/api/connection-details';
const SHOW_SETTINGS_MENU = process.env.NEXT_PUBLIC_SHOW_SETTINGS_MENU == 'true';

export function PageClientImpl(props: {
  roomName: string;
  region?: string;
  invite?: string;
  hq: boolean;
  codec: VideoCodec;
  simulcast: boolean;
  singlePeerConnection: boolean;
}) {
  const [preJoinChoices, setPreJoinChoices] = React.useState<LocalUserChoices | undefined>(
    undefined,
  );
  const preJoinDefaults = React.useMemo(() => {
    return {
      username: '',
      videoEnabled: true,
      audioEnabled: true,
    };
  }, []);
  const [connectionDetails, setConnectionDetails] = React.useState<ConnectionDetails | undefined>(
    undefined,
  );

  const handlePreJoinSubmit = React.useCallback(async (values: LocalUserChoices) => {
    setPreJoinChoices(values);
    const url = new URL(CONN_DETAILS_ENDPOINT, window.location.origin);
    url.searchParams.append('roomName', props.roomName);
    url.searchParams.append('participantName', values.username);
    if (props.invite) {
      url.searchParams.append('invite', props.invite);
    }
    if (props.region) {
      url.searchParams.append('region', props.region);
    }
    const connectionDetailsResp = await fetch(url.toString());
    if (!connectionDetailsResp.ok) {
      // без действующего приглашения сервер пропуск не выдаёт (app/api/connection-details)
      alert(await connectionDetailsResp.text());
      setPreJoinChoices(undefined);
      return;
    }
    const connectionDetailsData = await connectionDetailsResp.json();
    setConnectionDetails(connectionDetailsData);
  }, []);
  const handlePreJoinError = React.useCallback((e: any) => console.error(e), []);

  return (
    <main data-lk-theme="default" style={{ height: '100%' }}>
      {connectionDetails === undefined || preJoinChoices === undefined ? (
        <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
          <PreJoin
            defaults={preJoinDefaults}
            onSubmit={handlePreJoinSubmit}
            onError={handlePreJoinError}
          />
        </div>
      ) : (
        <VideoConferenceComponent
          connectionDetails={connectionDetails}
          userChoices={preJoinChoices}
          options={{
            codec: props.codec,
            hq: props.hq,
            simulcast: props.simulcast,
            singlePeerConnection: props.singlePeerConnection,
          }}
        />
      )}
    </main>
  );
}

function VideoConferenceComponent(props: {
  userChoices: LocalUserChoices;
  connectionDetails: ConnectionDetails;
  options: {
    hq: boolean;
    codec: VideoCodec;
    simulcast: boolean;
    singlePeerConnection: boolean;
  };
}) {
  const keyProvider = new ExternalE2EEKeyProvider();
  const { worker, e2eePassphrase } = useSetupE2EE();
  const e2eeEnabled = !!(e2eePassphrase && worker);

  const [e2eeSetupComplete, setE2eeSetupComplete] = React.useState(false);

  const roomOptions = React.useMemo((): RoomOptions => {
    // === Параметры проекта (docs/04-parameters.md) ===
    // Кодек по умолчанию H.264: единственный, который и кодируется аппаратно на Mac, и пишется egress.
    let videoCodec: VideoCodec | undefined = props.options.codec ? props.options.codec : 'h264';
    if (e2eeEnabled && (videoCodec === 'av1' || videoCodec === 'vp9')) {
      videoCodec = undefined;
    }
    const videoCaptureDefaults: VideoCaptureOptions = {
      deviceId: props.userChoices.videoDeviceId ?? undefined,
      // по умолчанию 1080p (фаза 5), ?hq=true — 4K
      resolution: props.options.hq ? VideoPresets.h2160.resolution : VideoPresets.h1080.resolution,
    };
    const publishDefaults: TrackPublishDefaults = {
      videoCodec,
      // Simulcast: полный слой + 720p. Нижний сервер отдаёт собеседнику, когда у того проседает приём;
      // запись берёт верхний. Включать только тому, кто в одной сети с сервером (?simulcast=true):
      // у собеседника второй слой никому не нужен и отъедал бы его канал у основного.
      simulcast: props.options.simulcast,
      videoSimulcastLayers: [VideoPresets.h720],
      videoEncoding: props.options.hq
        ? { maxBitrate: 16_000_000, maxFramerate: 30 }
        : { maxBitrate: 6_000_000, maxFramerate: 30 },
      degradationPreference: 'maintain-resolution',
      audioPreset: { maxBitrate: 510_000 }, // встроенный максимум musicHighQualityStereo — всего 128k
      forceStereo: true,
      red: false, // RED ломает запись: egress пишет audio/red как тишину (-91 дБ), проверено 25.09
      dtx: false,
    };
    return {
      videoCaptureDefaults: videoCaptureDefaults,
      publishDefaults: publishDefaults,
      audioCaptureDefaults: {
        deviceId: props.userChoices.audioDeviceId ?? undefined,
        echoCancellation: false, // НАУШНИКИ обязательны
        noiseSuppression: false,
        autoGainControl: false,
        voiceIsolation: false,
        channelCount: 2,
        sampleRate: 48000,
      },
      adaptiveStream: false,
      dynacast: false,
      e2ee: keyProvider && worker && e2eeEnabled ? { keyProvider, worker } : undefined,
      singlePeerConnection: props.options.singlePeerConnection,
    };
  }, [props.userChoices, props.options.hq, props.options.codec, props.options.simulcast]);

  const room = React.useMemo(() => new Room(roomOptions), []);

  // === Отладка: в консоли браузера доступны window.room и lkStats() ===
  React.useEffect(() => {
    const w = window as any;
    w.room = room;
    w.lkStats = async () => {
      const rows: Record<string, unknown>[] = [];
      const collect = async (who: string, pub: any, dir: 'outbound-rtp' | 'inbound-rtp') => {
        const track: any = pub?.track;
        if (!track?.getRTCStatsReport) return;
        const report: RTCStatsReport | undefined = await track.getRTCStatsReport();
        const st: any = track.mediaStreamTrack?.getSettings?.() ?? {};
        // уровень сигнала с микрофона (0..1): около нуля при речи — микрофон молчит или выключен
        let level: number | undefined;
        report?.forEach((m: any) => {
          if (m.type === 'media-source' && m.audioLevel !== undefined) level = m.audioLevel;
        });
        report?.forEach((s: any) => {
          if (s.type !== dir) return;
          const codec: any = s.codecId ? report.get(s.codecId) : undefined;
          rows.push({
            who,
            kind: s.kind,
            rid: s.rid, // слой simulcast: q — 720p, h — полный
            muted: pub?.isMuted,
            level: s.kind === 'audio' && level !== undefined ? Math.round(level * 1000) / 1000 : undefined,
            codec: codec?.mimeType,
            fmtp: codec?.sdpFmtpLine,
            impl: dir === 'outbound-rtp' ? s.encoderImplementation : s.decoderImplementation,
            hw: dir === 'outbound-rtp' ? s.powerEfficientEncoder : s.powerEfficientDecoder,
            size: s.frameWidth ? `${s.frameWidth}x${s.frameHeight}` : undefined,
            fps: s.framesPerSecond,
            kbps: s.targetBitrate ? Math.round(s.targetBitrate / 1000) : undefined,
            limit: s.qualityLimitationReason,
            lost: s.packetsLost,
            // сколько раз получатели просили ключевой кадр и сколько их реально закодировано
            pli: dir === 'outbound-rtp' ? s.pliCount : undefined,
            nack: dir === 'outbound-rtp' ? s.nackCount : undefined,
            keyframes: dir === 'outbound-rtp' ? s.keyFramesEncoded : s.keyFramesDecoded,
            jitterMs: s.jitter !== undefined ? Math.round(s.jitter * 1000) : undefined,
            capture: who !== 'я' ? undefined : st.width
              ? `${st.width}x${st.height}@${st.frameRate}`
              : `${st.channelCount}ch ${st.sampleRate}Hz aec=${st.echoCancellation} ns=${st.noiseSuppression} agc=${st.autoGainControl}`,
          });
        });
      };
      for (const pub of room.localParticipant.trackPublications.values()) await collect('я', pub, 'outbound-rtp');
      for (const p of room.remoteParticipants.values())
        for (const pub of p.trackPublications.values()) await collect(p.identity, pub, 'inbound-rtp');
      console.table(rows);
      return rows;
    };
    // Тест записи при смене слоя: lkTop(false) выключает у себя верхний слой, lkTop(true) возвращает
    w.lkTop = async (on: boolean) => {
      const sender = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track?.sender;
      if (!sender) return 'камера не опубликована';
      const params = sender.getParameters();
      if (params.encodings.length < 2) return 'simulcast выключен: слой один';
      params.encodings[params.encodings.length - 1].active = on;
      await sender.setParameters(params);
      return params.encodings.map((e) => `${e.rid}:${e.active ? 'вкл' : 'выкл'}`).join(' ');
    };
  }, [room]);

  React.useEffect(() => {
    if (e2eeEnabled) {
      keyProvider
        .setKey(decodePassphrase(e2eePassphrase))
        .then(() => {
          room.setE2EEEnabled(true).catch((e) => {
            if (e instanceof DeviceUnsupportedError) {
              alert(
                `You're trying to join an encrypted meeting, but your browser does not support it. Please update it to the latest version and try again.`,
              );
              console.error(e);
            } else {
              throw e;
            }
          });
        })
        .then(() => setE2eeSetupComplete(true));
    } else {
      setE2eeSetupComplete(true);
    }
  }, [e2eeEnabled, room, e2eePassphrase]);

  const connectOptions = React.useMemo((): RoomConnectOptions => {
    return {
      autoSubscribe: true,
    };
  }, []);

  React.useEffect(() => {
    room.on(RoomEvent.Disconnected, handleOnLeave);
    room.on(RoomEvent.EncryptionError, handleEncryptionError);
    room.on(RoomEvent.MediaDevicesError, handleError);

    if (e2eeSetupComplete) {
      room
        .connect(
          props.connectionDetails.serverUrl,
          props.connectionDetails.participantToken,
          connectOptions,
        )
        .catch((error) => {
          handleError(error);
        });
      if (props.userChoices.videoEnabled) {
        room.localParticipant.setCameraEnabled(true).catch((error) => {
          handleError(error);
        });
      }
      if (props.userChoices.audioEnabled) {
        room.localParticipant.setMicrophoneEnabled(true).catch((error) => {
          handleError(error);
        });
      }
    }
    return () => {
      room.off(RoomEvent.Disconnected, handleOnLeave);
      room.off(RoomEvent.EncryptionError, handleEncryptionError);
      room.off(RoomEvent.MediaDevicesError, handleError);
    };
  }, [e2eeSetupComplete, room, props.connectionDetails, props.userChoices]);

  const lowPowerMode = useLowCPUOptimizer(room);

  const router = useRouter();
  const handleOnLeave = React.useCallback(() => router.push('/'), [router]);
  const handleError = React.useCallback((error: Error) => {
    console.error(error);
    alert(`Encountered an unexpected error, check the console logs for details: ${error.message}`);
  }, []);
  const handleEncryptionError = React.useCallback((error: Error) => {
    console.error(error);
    alert(
      `Encountered an unexpected encryption error, check the console logs for details: ${error.message}`,
    );
  }, []);

  React.useEffect(() => {
    if (lowPowerMode) {
      console.warn('Low power mode enabled');
    }
  }, [lowPowerMode]);

  return (
    <div className="lk-room-container">
      <RoomContext.Provider value={room}>
        <KeyboardShortcuts />
        <VideoConference
          chatMessageFormatter={formatChatMessageLinks}
          SettingsComponent={SHOW_SETTINGS_MENU ? SettingsMenu : undefined}
        />
        <DebugMode />
        <RecordingIndicator />
      </RoomContext.Provider>
    </div>
  );
}
