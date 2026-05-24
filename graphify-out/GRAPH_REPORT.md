# Graph Report - .  (2026-05-24)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 580 nodes · 1155 edges · 29 communities (28 shown, 1 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 27 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `38c320d9`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]

## God Nodes (most connected - your core abstractions)
1. `ChatList()` - 39 edges
2. `websocket_endpoint()` - 33 edges
3. `useDarkMode()` - 27 edges
4. `FileMessage()` - 25 edges
5. `utc_now()` - 20 edges
6. `compilerOptions` - 20 edges
7. `compilerOptions` - 18 edges
8. `ContactInfo()` - 17 edges
9. `dt_to_epoch_ms()` - 15 edges
10. `encryptFileBytesClientSide()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `back-end directory` --conceptually_related_to--> `front-end/index.html`  [INFERRED]
  README.md → front-end/index.html
- `getMessageSeenBy()` --calls--> `try_object_id()`  [EXTRACTED]
  front-end/src/config/api.ts → back-end/api.py
- `back-end/requirements.txt` --references--> `PyJWT`  [EXTRACTED]
  back-end/requirements.txt → README.md
- `back-end/requirements.txt` --references--> `python-dotenv`  [EXTRACTED]
  back-end/requirements.txt → README.md
- `websocket_endpoint()` --calls--> `generate_conversation_summary()`  [INFERRED]
  back-end/api.py → back-end/ai_service.py

## Communities (29 total, 1 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (56): AIChatRoom(), DarkModeToggle(), ForgotPassword(), Step, Login(), LoginProps, NewChatModal(), NewChatModalProps (+48 more)

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (46): Avatar(), avatarCache, avatarFetching, AvatarProps, fetchAvatar(), getAvatarDisplayUrl(), getColorIndex(), getInitials() (+38 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (42): Props, DownloadState, DownloadSubscriber, DownloadTask, fileDownloadTasks, FileMessage(), FileMessageProps, FileUpload() (+34 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (14): AI_EMPTY_STATE_PROMPTS, markdownComponents, ChatRoomProps, GroupMember, markdownComponents, MemoMarkdown, pendingUploadedFileByChat, persianJalaliDayMonthFmt (+6 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (31): dependencies, emoji-mart, framer-motion, lucide-react, react, react-dom, react-markdown, react-router-dom (+23 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (18): ChatList(), ChatListProps, ConfirmAction, extractLastMessageFile(), formatTime(), getFilePreviewLabel(), getLastMessagePreview(), IconProps (+10 more)

### Community 6 - "Community 6"
Cohesion: 0.14
Nodes (27): add_reaction(), ai_model_label_from_key(), broadcast(), delete_ai_message(), delete_chat(), extract_message_file_ids(), forward_message(), get_chat_stats() (+19 more)

### Community 7 - "Community 7"
Cohesion: 0.13
Nodes (26): AIChatRenameRequest, AICreateChatRequest, ChatCreateRequest, consume_quota(), ForwardMessageRequest, get_ai_pro_usage_status(), get_my_pins(), _get_pinned_from_user_doc() (+18 more)

### Community 8 - "Community 8"
Cohesion: 0.10
Nodes (25): AI Assistant, api.py, _coerce_chunk_text(), _contains_cjk(), generate_ai_response_stream(), get_system_prompt(), back-end directory, bcrypt (+17 more)

### Community 9 - "Community 9"
Cohesion: 0.13
Nodes (23): aiofiles, _base64url_decode_bytes(), decrypt_client_file_bytes(), _derive_client_shared_key(), download_file(), encrypt_client_file_bytes(), _remap_forward_file_to_target_chat(), startup_db() (+15 more)

### Community 10 - "Community 10"
Cohesion: 0.19
Nodes (23): attach_session_to_user(), bcrypt_checkpw_async(), complete_registration(), create_access_token(), extract_client_ip(), get_user_from_session_token(), hash_access_token(), jwt_decode_async() (+15 more)

### Community 11 - "Community 11"
Cohesion: 0.11
Nodes (22): Step 1: Send verification code to email, Step 2: Verify the code sent to email, Request password reset - sends code to email, Verify reset code and change password, register_email(), request_password_reset(), verify_and_reset_password(), verify_registration_code() (+14 more)

### Community 12 - "Community 12"
Cohesion: 0.14
Nodes (22): generate_conversation_summary(), ai_model_name_from_key(), build_last_message(), create_ai_chat(), decrypt_scoped_text(), decrypt_with_fallback(), delete_ai_chat(), _derive_enc_key() (+14 more)

### Community 13 - "Community 13"
Cohesion: 0.09
Nodes (21): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection, moduleResolution (+13 more)

### Community 14 - "Community 14"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, moduleResolution, noEmit (+11 more)

### Community 15 - "Community 15"
Cohesion: 0.16
Nodes (10): ConfirmAction, Devices(), DeviceSession, DevicesProps, toJalaliTehran(), toPersianDigits(), LoginEvent, LoginLogs() (+2 more)

### Community 16 - "Community 16"
Cohesion: 0.17
Nodes (15): block_user(), decrypt_user_bio(), _filter_recipients_by_block_status(), force_user_offline(), _get_blocked_from_user_doc(), get_chat_list(), get_chat_members(), get_current_user() (+7 more)

### Community 17 - "Community 17"
Cohesion: 0.19
Nodes (9): NotificationItem, inferNotificationType(), normalizeInput(), NotificationInput, NotificationType, notify(), subscribeNotifications(), Subscriber (+1 more)

### Community 18 - "Community 18"
Cohesion: 0.25
Nodes (7): btnStyle, MiniMusicPlayer(), MusicPlayerContextValue, MusicPlayerProvider(), MusicPlayerState, TrackInfo, useMusicPlayer()

### Community 19 - "Community 19"
Cohesion: 0.29
Nodes (8): build_group_invite_link(), create_group(), create_or_get_chat(), get_chat_id_for_two(), get_profile_groups(), join_group(), update_group(), utc_now()

### Community 20 - "Community 20"
Cohesion: 0.33
Nodes (7): formatDayLabel(), formatMessageTime(), iranDayNumber(), iranShiftedDate(), iranYMD(), normalizeTs(), sameDay()

### Community 21 - "Community 21"
Cohesion: 0.47
Nodes (6): normalize_username(), public_username_available(), Public endpoint for checking username availability during registration, update_profile(), username_available(), validate_username()

### Community 22 - "Community 22"
Cohesion: 0.50
Nodes (4): formatMessageTime(), iranShiftedDate(), normalizeTs(), toPersianDigits()

### Community 23 - "Community 23"
Cohesion: 0.67
Nodes (3): ChatRoom(), resolveVerified(), toPersianDigits()

### Community 24 - "Community 24"
Cohesion: 0.67
Nodes (3): EMOJIS, ReactionPicker(), ReactionPickerProps

## Knowledge Gaps
- **163 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+158 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getMessageSeenBy()` connect `Community 0` to `Community 3`, `Community 6`, `Community 7`?**
  _High betweenness centrality (0.361) - this node is a cross-community bridge._
- **Why does `ChatList()` connect `Community 5` to `Community 0`, `Community 1`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **Why does `useDarkMode()` connect `Community 0` to `Community 5`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `websocket_endpoint()` (e.g. with `generate_conversation_summary()` and `aggregate_reactions()`) actually correct?**
  _`websocket_endpoint()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Step 1: Send verification code to email`, `Step 2: Verify the code sent to email`, `Step 3: Complete registration with name, username and password` to the rest of the system?**
  _180 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05150905432595573 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.07542087542087542 - nodes in this community are weakly interconnected._