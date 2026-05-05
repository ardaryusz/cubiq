import { useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { applyAppTheme } from '../utils/theme';
import type { StreamDeltaPayload, StreamDonePayload, StreamErrorPayload } from '../types/streaming';
import type { Message } from '../QuickAskApp';

export interface UseQuickAskStreamParams {
  activeRequestRef: React.MutableRefObject<string | null>;
  accumulatorRef: React.MutableRefObject<string>;
  needsRenderRef: React.MutableRefObject<boolean>;
  renderRafRef: React.MutableRefObject<number | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  setRenderText: React.Dispatch<React.SetStateAction<string>>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useQuickAskStream({
  activeRequestRef,
  accumulatorRef,
  needsRenderRef,
  renderRafRef,
  messagesEndRef,
  setRenderText,
  setMessages,
  setIsStreaming,
  setError
}: UseQuickAskStreamParams) {
  const unlistenFnsRef = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;
    const unlistens: UnlistenFn[] = [];

    const setup = async () => {
      console.log('[QA] registering stream listeners via global listen()');
      try {
        const unTheme = await listen<{ app_theme: string }>('cubiq:theme_changed', ({ payload }) => {
          if (payload?.app_theme) applyAppTheme(payload.app_theme);
        });
        
        const unDelta = await listen<StreamDeltaPayload>('cubiq:stream_delta', ({ payload }) => {
          console.log('[QA delta]', payload.request_id, 'active=', activeRequestRef.current,
            'match=', payload.request_id === activeRequestRef.current,
            'preview=', payload.delta.slice(0, 20));
          if (payload.request_id !== activeRequestRef.current) return;

          accumulatorRef.current += payload.delta;
          const full = accumulatorRef.current;

          // High-framerate markdown render and stream-following scroll (max ~60fps)
          needsRenderRef.current = true;
          if (!renderRafRef.current) {
            renderRafRef.current = requestAnimationFrame(() => {
              renderRafRef.current = null;
              if (needsRenderRef.current) {
                setRenderText(full);
                needsRenderRef.current = false;
              }
              // QuickAsk scrolls to bottom continuously during streaming
              messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
            });
          }
        });

        const unDone = await listen<StreamDonePayload>('cubiq:stream_done', ({ payload }) => {
          console.log('[QA done]', payload.request_id, 'active=', activeRequestRef.current);
          if (payload.request_id !== activeRequestRef.current) return;

          const full = accumulatorRef.current;

          // Flush any pending render and do a final render
          if (renderRafRef.current) {
            cancelAnimationFrame(renderRafRef.current);
            renderRafRef.current = null;
          }
          needsRenderRef.current = false;
          setRenderText(full);

          setMessages(prev => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === 'assistant') {
              updated[updated.length - 1] = { ...last, content: full, isStreaming: false };
            }
            return updated;
          });
          activeRequestRef.current = null;
          accumulatorRef.current = '';
          setIsStreaming(false);
          // Don't clear renderText immediately so the bubble doesn't flicker
          // It will be cleared on handleSend
        });

        const unError = await listen<StreamErrorPayload>('cubiq:stream_error', ({ payload }) => {
          console.error('[QA error]', payload.request_id, 'active=', activeRequestRef.current, payload.message);
          if (payload.request_id !== activeRequestRef.current) return;

          setMessages(prev => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === 'assistant' && last.isStreaming) updated.pop();
            return updated;
          });

          if (renderRafRef.current) {
            cancelAnimationFrame(renderRafRef.current);
            renderRafRef.current = null;
          }
          needsRenderRef.current = false;

          const msg = payload.message;
          setError(msg.includes('API key is not set') ? 'missing_key' : msg);
          activeRequestRef.current = null;
          accumulatorRef.current = '';
          setIsStreaming(false);
          setRenderText('');
        });

        if (cancelled) {
          // Effect cleanup ran before setup finished (React Strict Mode double-invoke)
          unTheme(); unDelta(); unDone(); unError();
          console.log('[QA] listeners cancelled before setup completed, cleaned up');
        } else {
          unlistens.push(unTheme, unDelta, unDone, unError);
          unlistenFnsRef.current = unlistens;
          console.log('[QA] stream listeners registered OK');
        }
      } catch (err) {
        console.error('[QA] Failed to register stream listeners:', err);
      }
    };

    setup();

    return () => {
      cancelled = true;
      // Immediately unregister any already-registered listeners
      unlistens.forEach(fn => fn());
      unlistenFnsRef.current = [];
      console.log('[QA] stream listeners cleanup');
    };
  }, [activeRequestRef, accumulatorRef, needsRenderRef, renderRafRef, messagesEndRef, setError, setIsStreaming, setMessages, setRenderText]);
}
