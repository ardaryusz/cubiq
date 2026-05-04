export interface StreamDeltaPayload {
  request_id: string;
  delta: string;
}

export interface StreamDonePayload {
  request_id: string;
}

export interface StreamErrorPayload {
  request_id: string;
  message: string;
}
