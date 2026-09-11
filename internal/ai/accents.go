package ai

import "fmt"

func accentRequest(in Object) (Object, error) {
	cues, ok := in["cues"].([]any)
	if !ok || len(cues) < 1 || len(cues) > 20 {
		return nil, fmt.Errorf("한 번에 1~20문장을 선택해 주세요.")
	}
	seen := map[string]bool{}
	out := []any{}
	size := 0
	for _, x := range cues {
		c := obj(x)
		id := str(c["id"])
		if !plain(c["id"], 100) || seen[id] || !plain(c["text"], 2000) || !finite(c["start"], 0, 86400) || !finite(c["end"], 0, 86400) || num(c["end"]) <= num(c["start"]) {
			return nil, fmt.Errorf("제안할 문장 정보를 확인해 주세요.")
		}
		seen[id] = true
		size += length(str(c["text"]))
		out = append(out, Object{"id": id, "text": c["text"], "start": c["start"], "end": c["end"]})
	}
	if size > 4000 {
		return nil, fmt.Errorf("한 번에 4,000자까지 제안할 수 있습니다.")
	}
	return Object{"requestId": in["requestId"], "instruction": in["instruction"], "cues": out}, nil
}
func accentProposal(v, in Object) (Object, error) {
	ids := map[string]bool{}
	seen := map[string]bool{}
	for _, x := range array(in["cues"]) {
		ids[str(obj(x)["id"])] = true
	}
	changes := array(v["changes"])
	if len(changes) > len(ids) {
		return nil, fmt.Errorf("강조 제안이 너무 많습니다.")
	}
	out := []any{}
	for _, x := range changes {
		c := obj(x)
		id := str(c["id"])
		cap, capOK := c["captionEnabled"].(bool)
		zoom, zoomOK := c["zoomEnabled"].(bool)
		if !exact(c, "id", "reason", "captionEnabled", "zoomEnabled", "zoomScale") || !ids[id] || seen[id] || !plain(c["reason"], 800) || !capOK || !zoomOK || (!cap && !zoom) || !finite(c["zoomScale"], 1, 1.15) {
			return nil, fmt.Errorf("허용되지 않은 강조 제안입니다.")
		}
		seen[id] = true
		out = append(out, c)
	}
	return Object{"requestId": in["requestId"], "changes": out}, nil
}
