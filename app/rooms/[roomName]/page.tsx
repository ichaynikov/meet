import * as React from 'react';
import { PageClientImpl } from './PageClientImpl';
import { isVideoCodec } from '@/lib/types';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ roomName: string }>;
  searchParams: Promise<{
    // FIXME: We should not allow values for regions if in playground mode.
    region?: string;
    hq?: string;
    codec?: string;
    simulcast?: string;
    invite?: string;
    singlePC?: string;
  }>;
}) {
  const _params = await params;
  const _searchParams = await searchParams;
  const codec =
    typeof _searchParams.codec === 'string' && isVideoCodec(_searchParams.codec)
      ? _searchParams.codec
      : 'h264'; // проект: H.264 по умолчанию (docs/04-parameters.md)
  const hq = _searchParams.hq !== 'false'; // проект: максимум по умолчанию, ?hq=false — облегчённый режим
  const singlePC = _searchParams.singlePC !== 'false';
  // simulcast только у того, кто в одной сети с сервером: ?simulcast=true (docs/04-parameters.md)
  const simulcast = _searchParams.simulcast === 'true';

  return (
    <PageClientImpl
      roomName={_params.roomName}
      region={_searchParams.region}
      invite={typeof _searchParams.invite === 'string' ? _searchParams.invite : undefined}
      hq={hq}
      codec={codec}
      simulcast={simulcast}
      singlePeerConnection={singlePC}
    />
  );
}
