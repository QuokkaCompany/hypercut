package media

import (
	"fmt"
	"math"
	"strings"
	"time"
)

func Project(v, m Object, effects map[string]Object) (Object, error) {
	version := Num(v["version"])
	if Str(v["format"]) != "hypercut-project" || version < 1 || version > 8 || math.Trunc(version) != version {
		return nil, fmt.Errorf("지원하지 않는 HyperCut 프로젝트입니다.")
	}
	for key, since := range map[string]float64{"speechProtection": 2, "transcript": 3, "captionStyle": 4, "effects": 5} {
		if _, ok := v[key]; !ok && version >= since {
			return nil, fmt.Errorf("Missing project field: %s", key)
		}
	}
	// Older versions cannot opt into fields introduced by later schemas.
	copy := Object{}
	for k, x := range v {
		copy[k] = x
	}
	v = copy
	for key, since := range map[string]float64{"speechProtection": 2, "transcript": 3, "captionStyle": 4, "effects": 5} {
		if version < since {
			delete(v, key)
		}
	}
	source := Obj(v["media"])
	d := Num(source["duration"])
	_, nameOK := source["name"].(string)
	if !nameOK || !hashPattern.MatchString(Str(source["fingerprint"])) || d <= 0 || !finite(source["duration"]) {
		return nil, fmt.Errorf("Invalid source identity")
	}
	if m != nil && (source["fingerprint"] != m["fingerprint"] || math.Abs(d-Num(m["duration"])) >= .001) {
		return nil, fmt.Errorf("Project does not match the uploaded source.")
	}
	s, e := ValidateSettings(v["settings"])
	if e != nil {
		return nil, e
	}
	speech, e := SpeechSettings(v["speechProtection"])
	if e != nil {
		return nil, e
	}
	style, e := Style(v["captionStyle"])
	if e != nil {
		return nil, e
	}
	fx, e := Effects(v["effects"], d)
	if e != nil {
		return nil, e
	}
	transcript, e := Transcript(v["transcript"], d)
	if e != nil {
		return nil, e
	}
	if !integer(v["trackIndex"]) || Num(v["trackIndex"]) < 0 {
		return nil, fmt.Errorf("Invalid project track")
	}
	if m != nil {
		if _, e = Track(m, v["trackIndex"]); e != nil {
			return nil, e
		}
		if transcript != nil {
			track, err := Track(m, transcript["trackIndex"])
			if err != nil || Num(transcript["channel"]) >= Num(track["channels"]) {
				return nil, fmt.Errorf("Transcript track is unavailable.")
			}
		}
	}
	if effects != nil {
		for _, x := range Array(fx["assets"]) {
			a := Obj(x)
			stored := effects[Str(a["id"])]
			if stored == nil || stored["fingerprint"] != a["fingerprint"] || Num(stored["duration"]) != Num(a["duration"]) {
				return nil, fmt.Errorf("Effect does not match the uploaded source.")
			}
		}
	}
	cuts, ok := v["cuts"].([]any)
	if !ok || len(cuts) > 50000 {
		return nil, fmt.Errorf("Invalid project cuts")
	}
	ids := map[string]bool{}
	out := []any{}
	for _, x := range cuts {
		c := Obj(x)
		id, idok := c["id"].(string)
		_, onok := c["enabled"].(bool)
		if !idok || !onok || ids[id] || !between(c["start"], 0, d) || !between(c["end"], 0, d) || Num(c["start"]) >= Num(c["end"]) {
			return nil, fmt.Errorf("Invalid project cut")
		}
		ids[id] = true
		reason := "silence"
		if Str(c["reason"]) == "manual" {
			reason = "manual"
		}
		out = append(out, Object{"id": id, "enabled": c["enabled"], "start": c["start"], "end": c["end"], "reason": reason})
	}
	glossary := ""
	if version >= 6 {
		var ok bool
		glossary, ok = v["glossary"].(string)
		if !ok || textLength(glossary) > 2000 || controls.MatchString(glossary) || strings.ContainsRune(glossary, 127) {
			return nil, fmt.Errorf("Invalid glossary")
		}
	}
	name := source["name"]
	if m != nil {
		name = m["name"]
	}
	return Object{"format": "hypercut-project", "version": 8, "media": Object{"name": name, "fingerprint": source["fingerprint"], "duration": d}, "settings": s, "speechProtection": speech, "transcript": transcript, "captionStyle": style, "effects": fx, "glossary": glossary, "trackIndex": v["trackIndex"], "cuts": out, "savedAt": time.Now().UTC().Format(time.RFC3339Nano)}, nil
}
