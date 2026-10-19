<!-- doc-id: rebuild-crudui-render-options -->
<!-- source-sha256: 04ec1ab211af8c1e6633a3ea4ea61094904c06fca92b1f91df3b91aefba7cf85 -->
# 재구현: 편집 폼의 render 옵션 decoder

[English](crudui-render-options.md)

- 요구 사항: 편집 페이지가 내장하는 폼 상태(`packages/gui/client/form-state.ts`)는 render 옵션(`action`, `hidden`, `formErrors`,
  `errors`)을 디코드하며, 타입 밖의 값은 멤버 이름과 함께 거부한다.
- 검색한 도구: `@polyspec/crudui-generator-core` 0.0.5(S-44-18 이전의 설치된 pin)는 decoder를 export하지 않는다. 0.0.7(현재 pin이며
  공개되어 있음)은 타입 `FormRenderOptions`와 `decodeFormTemplate`을 export하지만 render 옵션 decoder는 없다. 0.0.8은
  `decodeFormRenderOptions`(crudui C14.50)를 추가하지만 release 자산이 404를 응답하여 공개되지 않았다.
- 재구현하는 이유: 공개된 도구 중 render 옵션을 디코드하는 것이 없고, 클라이언트 코드의 lint에는 타입이 있는 decoder가 필요하다.
  `packages/gui/client/form-state.ts`의 `decodeRenderOptions`는 0.0.8 decoder와 같은 멤버와 타입만 검사하며 그 이상은 하지 않는다.
  알 수 없는 멤버는 fsm의 `FormRenderOptionsError`로 거부한다.
- 재시도 조건: crudui 0.0.8이 공개되면 `packages/gui`의 pin을 그것으로 옮기고 `decodeRenderOptions`를 제거한다.
