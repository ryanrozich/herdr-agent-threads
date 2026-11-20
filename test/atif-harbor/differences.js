// Adapted from harbor-framework/harbor, tests/unit/agents/installed/test_claude_code_trajectory.py
// and tests/unit/agents/installed/test_codex_trajectory.py at 110c71b32c268e1d113c3856869202842f8e37a6 (0.26.0).
// Copyright the Harbor authors. Apache-2.0; see LICENSE. Ported cases are named in the case tables.
import { expect } from "bun:test";
import { problems } from "../atif-schema.js";

export const EXPECTED_DIFFERENCES = [
  { id: "claude: tool_use_without_result_renders_call_without_observation", reason: "R7", kind: "by design", note: "Agent Threads retains a marked observation for a call that has no result." },
  { id: "codex: one_step_per_api_call_with_bundled_tool_calls", reason: "R6", kind: "not handled", note: "Agent Threads puts token totals on the turn's last step and does not write llm_call_count per API call." },
  { id: "claude: list_content_multiple_text_blocks_joined_verbatim", reason: "R4", kind: "not handled", note: "Agent Threads joins user text blocks with one newline; Harbor joins with two." },
  { id: "claude: list_content_non_text_non_tool_result_block_json_encoded", reason: "R5b", kind: "not handled", note: "Agent Threads records image metadata in extra.images but does not JSON-encode the image block into message." },
  { id: "claude: redacted_thinking_openrouter_payload_decoded_to_reasoning", reason: "R1", kind: "by design", note: "Agent Threads treats redacted_thinking as opaque; Harbor decodes OpenRouter's wrapper." },
  { id: "claude: distinct_subagent_ids_survive_the_combined_timeline", reason: "R2", kind: "by design", note: "Agent Threads nests helper steps and links them from the launching call; Harbor flattens them." },
];

export function checkCase(item, trajectory) {
  try {
    expect(problems(trajectory)).toEqual([]);
    const listed = EXPECTED_DIFFERENCES.find((entry) => entry.id === item.id);
    if (listed) { expect(item.diff?.reason).toBe(listed.reason); item.diff.check(trajectory); expect(() => item.facts(trajectory)).toThrow(); }
    else item.facts(trajectory);
  } catch (error) { throw new Error(`${item.id}: ${error.message}`); }
}

// Source inventory: every remaining pytest item is explicit; parameter indexes follow source order.
export const LEFT_OUT = [
  {
    "id": "claude: user_message_byte_faithful_property_hypothesis",
    "reason": "Hypothesis parameter corpus needs a separate fixed JavaScript corpus."
  },
  {
    "id": "claude: repeated_trajectory_conversions_do_not_leak_state",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "claude: tool_call_without_message_does_not_fabricate_assistant_text",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "claude: redacted_thinking_openrouter_malformed_payload_dropped",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "claude: string_content_empty_is_skipped",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "claude: string_content_whitespace_only_is_skipped",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "claude: list_content_empty_and_whitespace_only_parts_filtered",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "claude: fallback_content_non_str_non_list_byte_faithful",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "claude: fallback_branch_stringifies_non_dict_shapes[0]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "claude: fallback_branch_stringifies_non_dict_shapes[1]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "claude: fallback_branch_stringifies_non_dict_shapes[2]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "claude: fallback_branch_stringifies_non_dict_shapes[3]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "claude: list_branch_tool_result_path_unchanged",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "claude: list_branch_interleaved_text_and_tool_result",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "claude: stringify_uses_json_dumps_for_non_str",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "claude: byte_faithful_property_across_inputs[0]",
    "reason": "Hypothesis parameter corpus needs a separate fixed JavaScript corpus."
  },
  {
    "id": "claude: byte_faithful_property_across_inputs[1]",
    "reason": "Hypothesis parameter corpus needs a separate fixed JavaScript corpus."
  },
  {
    "id": "claude: byte_faithful_property_across_inputs[2]",
    "reason": "Hypothesis parameter corpus needs a separate fixed JavaScript corpus."
  },
  {
    "id": "claude: byte_faithful_property_across_inputs[3]",
    "reason": "Hypothesis parameter corpus needs a separate fixed JavaScript corpus."
  },
  {
    "id": "claude: byte_faithful_property_across_inputs[4]",
    "reason": "Hypothesis parameter corpus needs a separate fixed JavaScript corpus."
  },
  {
    "id": "claude: byte_faithful_property_across_inputs[5]",
    "reason": "Hypothesis parameter corpus needs a separate fixed JavaScript corpus."
  },
  {
    "id": "claude: byte_faithful_property_across_inputs[6]",
    "reason": "Hypothesis parameter corpus needs a separate fixed JavaScript corpus."
  },
  {
    "id": "claude: byte_faithful_property_across_inputs[7]",
    "reason": "Hypothesis parameter corpus needs a separate fixed JavaScript corpus."
  },
  {
    "id": "claude: byte_faithful_property_across_inputs[8]",
    "reason": "Hypothesis parameter corpus needs a separate fixed JavaScript corpus."
  },
  {
    "id": "claude: byte_faithful_property_across_inputs[9]",
    "reason": "Hypothesis parameter corpus needs a separate fixed JavaScript corpus."
  },
  {
    "id": "claude: byte_faithful_property_across_inputs[10]",
    "reason": "Hypothesis parameter corpus needs a separate fixed JavaScript corpus."
  },
  {
    "id": "claude: byte_faithful_property_across_inputs[11]",
    "reason": "Hypothesis parameter corpus needs a separate fixed JavaScript corpus."
  },
  {
    "id": "claude: byte_faithful_property_across_inputs[12]",
    "reason": "Hypothesis parameter corpus needs a separate fixed JavaScript corpus."
  },
  {
    "id": "claude: byte_faithful_property_across_inputs[13]",
    "reason": "Hypothesis parameter corpus needs a separate fixed JavaScript corpus."
  },
  {
    "id": "claude: duplicate_session_uuid_tool_result_is_deduped",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "claude: missing_result_event_estimates_cost_per_resolved_model",
    "reason": "Harbor uses litellm prices; Agent Threads has no price table."
  },
  {
    "id": "claude: reported_cost_remains_authoritative",
    "reason": "Harbor uses litellm prices; Agent Threads has no price table."
  },
  {
    "id": "claude: unpriceable_step_leaves_cost_unknown",
    "reason": "Harbor uses litellm prices; Agent Threads has no price table."
  },
  {
    "id": "claude: partially_priceable_steps_keep_priced_costs_but_no_total",
    "reason": "Harbor uses litellm prices; Agent Threads has no price table."
  },
  {
    "id": "claude: get_session_dir_returns_only_directory_with_jsonl",
    "reason": "Harbor tests log folder discovery; Agent Threads exports an explicit file."
  },
  {
    "id": "claude: get_session_dir_returns_none_with_multiple_directories_with_jsonl",
    "reason": "Harbor tests log folder discovery; Agent Threads exports an explicit file."
  },
  {
    "id": "claude: get_session_dir_returns_nested_session_dir",
    "reason": "Harbor tests log folder discovery; Agent Threads exports an explicit file."
  },
  {
    "id": "claude: get_session_dir_returns_none_with_multiple_nested_sessions_under_one_project",
    "reason": "Harbor tests log folder discovery; Agent Threads exports an explicit file."
  },
  {
    "id": "claude: get_session_dir_nested_multiple_projects_returns_none",
    "reason": "Harbor tests log folder discovery; Agent Threads exports an explicit file."
  },
  {
    "id": "claude: agent_steps_carry_llm_call_count",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "claude: subagent_file_events_become_sidechain_steps",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "claude: subagent_events_deduped_by_uuid_across_files",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "claude: inline_sidechain_events_stay_chronological",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "claude: root_model_prefers_main_chain_over_earlier_sidechain",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "claude: verbatim_production_layout",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: codex_subagent_rollouts_use_atif_children_without_copied_history",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: codex_grandchild_is_nested_under_its_parent",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: loaded_orphan_subagent_excludes_copied_history",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: codex_uses_active_turn_model_for_steps_and_pricing",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: incomplete_rollout_does_not_replace_valid_root[0]",
    "reason": "Harbor tests log folder discovery; Agent Threads exports an explicit file."
  },
  {
    "id": "codex: incomplete_rollout_does_not_replace_valid_root[1]",
    "reason": "Harbor tests log folder discovery; Agent Threads exports an explicit file."
  },
  {
    "id": "codex: missing_root_usage_keeps_combined_totals_unknown",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: tool_call_without_message_does_not_fabricate_assistant_text",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: converted_trajectory_emits_latest_atif_version",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: user_messages_are_never_grouped",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: web_search_calls_preserve_native_ids_and_get_unique_fallbacks",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: cumulative_usage_above_272k_keeps_per_call_short_context_pricing",
    "reason": "Harbor uses litellm prices; Agent Threads has no price table."
  },
  {
    "id": "codex: single_call_above_272k_uses_long_context_pricing",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: cache_write_usage_is_preserved_and_priced",
    "reason": "Harbor uses litellm prices; Agent Threads has no price table."
  },
  {
    "id": "codex: legacy_usage_without_cache_write_remains_supported",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: gpt_5_6_sol_500k_call_uses_long_context_pricing",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: mixed_context_calls_sum_each_calls_pricing_tier",
    "reason": "Harbor uses litellm prices; Agent Threads has no price table."
  },
  {
    "id": "codex: json_encoded_mcp_text_content_becomes_plain_text",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: content_item_array_becomes_plain_text",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: other_blocks_are_kept_as_json_text[0]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: other_blocks_are_kept_as_json_text[1]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: other_blocks_are_kept_as_json_text[2]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: other_blocks_are_kept_as_json_text[3]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: input_image_data_url_is_saved_next_to_trajectory",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: data_url_parameters_do_not_hide_the_media_type",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: mcp_image_block_is_saved",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: remote_image_url_is_kept_in_text[0]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: remote_image_url_is_kept_in_text[1]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: remote_image_url_is_kept_in_text[2]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: remote_image_url_is_kept_in_text[3]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: unstorable_images_are_omitted[0]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: unstorable_images_are_omitted[1]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: unstorable_images_are_omitted[2]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: structured_output_with_odd_type_values_is_kept_verbatim[0]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: structured_output_with_odd_type_values_is_kept_verbatim[1]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: structured_output_with_odd_type_values_is_kept_verbatim[2]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: structured_output_with_odd_type_values_is_kept_verbatim[3]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: structured_output_with_odd_type_values_is_kept_verbatim[4]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: dict_output_that_is_not_a_string_is_kept_as_json[0]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: dict_output_that_is_not_a_string_is_kept_as_json[1]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: dict_output_that_is_not_a_string_is_kept_as_json[2]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: dict_output_that_is_not_a_string_is_kept_as_json[3]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: dict_output_that_is_not_a_string_is_kept_as_json[4]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: data_url_containing_a_url_is_not_treated_as_remote",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: images_are_never_written_through_a_planted_symlink[0]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: images_are_never_written_through_a_planted_symlink[1]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: images_are_never_written_through_a_planted_symlink[2]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: other_json_values_are_not_python_reprs[0]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: other_json_values_are_not_python_reprs[1]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: other_json_values_are_not_python_reprs[2]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: other_json_values_are_not_python_reprs[3]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: other_json_values_are_not_python_reprs[4]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: other_json_values_are_not_python_reprs[5]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: other_json_values_are_not_python_reprs[6]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  },
  {
    "id": "codex: other_json_values_are_not_python_reprs[7]",
    "reason": "The session input and asserted ATIF facts have not yet been translated to JavaScript."
  }
];
export const COUNTS = { items: { pass: 18, listed: 6, leftOut: 100, total: 124 }, functions: { claude: 52, codex: 30, total: 82 } };
