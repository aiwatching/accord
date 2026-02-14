package com.example.frontend.controller;

import com.example.frontend.model.BatchDeleteRequest;
import com.example.frontend.model.BatchDeleteResponse;
import com.example.frontend.service.WebServerClient;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(PageController.class)
class PageControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private WebServerClient webServerClient;

    @Test
    void testBatchDeleteDevices_Success() throws Exception {
        // Arrange
        List<String> deviceIds = Arrays.asList("device1", "device2", "device3");
        BatchDeleteRequest request = new BatchDeleteRequest(deviceIds);

        BatchDeleteResponse mockResponse = new BatchDeleteResponse(
                true,
                deviceIds,
                Collections.emptyList(),
                3,
                3
        );

        when(webServerClient.batchDeleteDevices(any(BatchDeleteRequest.class)))
                .thenReturn(mockResponse);

        // Act & Assert
        mockMvc.perform(post("/api/pages/devices/batch-delete")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.totalDeleted").value(3))
                .andExpect(jsonPath("$.totalRequested").value(3))
                .andExpect(jsonPath("$.deleted.length()").value(3))
                .andExpect(jsonPath("$.failed.length()").value(0));

        verify(webServerClient, times(1)).batchDeleteDevices(any(BatchDeleteRequest.class));
    }

    @Test
    void testBatchDeleteDevices_PartialSuccess() throws Exception {
        // Arrange
        List<String> deviceIds = Arrays.asList("device1", "device2", "device3");
        BatchDeleteRequest request = new BatchDeleteRequest(deviceIds);

        BatchDeleteResponse.BatchDeleteError error = new BatchDeleteResponse.BatchDeleteError(
                "device3",
                "Device not found"
        );

        BatchDeleteResponse mockResponse = new BatchDeleteResponse(
                false,
                Arrays.asList("device1", "device2"),
                Collections.singletonList(error),
                3,
                2
        );

        when(webServerClient.batchDeleteDevices(any(BatchDeleteRequest.class)))
                .thenReturn(mockResponse);

        // Act & Assert
        mockMvc.perform(post("/api/pages/devices/batch-delete")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.totalDeleted").value(2))
                .andExpect(jsonPath("$.totalRequested").value(3))
                .andExpect(jsonPath("$.deleted.length()").value(2))
                .andExpect(jsonPath("$.failed.length()").value(1))
                .andExpect(jsonPath("$.failed[0].deviceId").value("device3"));

        verify(webServerClient, times(1)).batchDeleteDevices(any(BatchDeleteRequest.class));
    }

    @Test
    void testBatchDeleteDevices_EmptyList() throws Exception {
        // Arrange
        List<String> deviceIds = Collections.emptyList();
        BatchDeleteRequest request = new BatchDeleteRequest(deviceIds);

        BatchDeleteResponse mockResponse = new BatchDeleteResponse(
                true,
                Collections.emptyList(),
                Collections.emptyList(),
                0,
                0
        );

        when(webServerClient.batchDeleteDevices(any(BatchDeleteRequest.class)))
                .thenReturn(mockResponse);

        // Act & Assert
        mockMvc.perform(post("/api/pages/devices/batch-delete")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.totalDeleted").value(0));

        verify(webServerClient, times(1)).batchDeleteDevices(any(BatchDeleteRequest.class));
    }

    @Test
    void testGetDevicesPage_Success() throws Exception {
        // Arrange
        List<Object> mockDevices = Arrays.asList(
                Collections.singletonMap("id", "device1"),
                Collections.singletonMap("id", "device2")
        );

        when(webServerClient.getDashboardDevices()).thenReturn(mockDevices);

        // Act & Assert
        mockMvc.perform(get("/api/pages/devices"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Devices"))
                .andExpect(jsonPath("$.data").isArray())
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.timestamp").exists());

        verify(webServerClient, times(1)).getDashboardDevices();
    }

    @Test
    void testGetDevicesPage_EmptyList() throws Exception {
        // Arrange
        when(webServerClient.getDashboardDevices()).thenReturn(Collections.emptyList());

        // Act & Assert
        mockMvc.perform(get("/api/pages/devices"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Devices"))
                .andExpect(jsonPath("$.data").isArray())
                .andExpect(jsonPath("$.data.length()").value(0));

        verify(webServerClient, times(1)).getDashboardDevices();
    }

    @Test
    void testDeleteDevice() throws Exception {
        // Arrange
        String deviceId = "device123";
        doNothing().when(webServerClient).deleteDevice(deviceId);

        // Act & Assert
        mockMvc.perform(delete("/api/pages/devices/" + deviceId))
                .andExpect(status().isNoContent());

        verify(webServerClient, times(1)).deleteDevice(deviceId);
    }

    @Test
    void testGetDeviceDetailsPage_Success() throws Exception {
        // Arrange
        String deviceId = "device123";
        Object mockDevice = Collections.singletonMap("id", deviceId);

        when(webServerClient.getDeviceDetails(deviceId)).thenReturn(mockDevice);

        // Act & Assert
        mockMvc.perform(get("/api/pages/devices/" + deviceId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Device Details"))
                .andExpect(jsonPath("$.data.id").value(deviceId));

        verify(webServerClient, times(1)).getDeviceDetails(deviceId);
    }

    @Test
    void testGetDeviceDetailsPage_NotFound() throws Exception {
        // Arrange
        String deviceId = "nonexistent";

        when(webServerClient.getDeviceDetails(deviceId)).thenReturn(null);

        // Act & Assert
        mockMvc.perform(get("/api/pages/devices/" + deviceId))
                .andExpect(status().isNotFound());

        verify(webServerClient, times(1)).getDeviceDetails(deviceId);
    }

    @Test
    void testGetInterfacesPage_Success() throws Exception {
        // Arrange
        Map<String, Object> mockResponse = new java.util.LinkedHashMap<>();
        List<Object> mockInterfaces = Arrays.asList(
                Collections.singletonMap("id", "if1"),
                Collections.singletonMap("id", "if2")
        );
        Map<String, Object> pagination = new java.util.LinkedHashMap<>();
        pagination.put("page", 1);
        pagination.put("pageSize", 50);
        pagination.put("totalItems", 2);
        pagination.put("totalPages", 1);

        mockResponse.put("interfaces", mockInterfaces);
        mockResponse.put("pagination", pagination);

        when(webServerClient.getAllInterfaces(any())).thenReturn(mockResponse);

        // Act & Assert
        mockMvc.perform(get("/api/pages/interfaces"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Device Interfaces"))
                .andExpect(jsonPath("$.data.interfaces").isArray())
                .andExpect(jsonPath("$.data.interfaces.length()").value(2))
                .andExpect(jsonPath("$.data.pagination").exists())
                .andExpect(jsonPath("$.timestamp").exists());

        verify(webServerClient, times(1)).getAllInterfaces(any());
    }

    @Test
    void testGetInterfacesPage_WithFilters() throws Exception {
        // Arrange
        Map<String, Object> mockResponse = new java.util.LinkedHashMap<>();
        List<Object> mockInterfaces = Collections.singletonList(
                Collections.singletonMap("id", "if1")
        );
        Map<String, Object> pagination = new java.util.LinkedHashMap<>();
        pagination.put("page", 1);
        pagination.put("pageSize", 25);
        pagination.put("totalItems", 1);
        pagination.put("totalPages", 1);

        mockResponse.put("interfaces", mockInterfaces);
        mockResponse.put("pagination", pagination);

        when(webServerClient.getAllInterfaces(any())).thenReturn(mockResponse);

        // Act & Assert
        mockMvc.perform(get("/api/pages/interfaces")
                        .param("deviceId", "device1")
                        .param("type", "ethernet")
                        .param("status", "up")
                        .param("enabled", "true")
                        .param("page", "1")
                        .param("pageSize", "25"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Device Interfaces"))
                .andExpect(jsonPath("$.data.interfaces").isArray())
                .andExpect(jsonPath("$.data.pagination").exists());

        verify(webServerClient, times(1)).getAllInterfaces(any());
    }

    @Test
    void testGetInterfacesPage_EmptyList() throws Exception {
        // Arrange
        Map<String, Object> mockResponse = new java.util.LinkedHashMap<>();
        mockResponse.put("interfaces", Collections.emptyList());
        Map<String, Object> pagination = new java.util.LinkedHashMap<>();
        pagination.put("page", 1);
        pagination.put("pageSize", 50);
        pagination.put("totalItems", 0);
        pagination.put("totalPages", 0);
        mockResponse.put("pagination", pagination);

        when(webServerClient.getAllInterfaces(any())).thenReturn(mockResponse);

        // Act & Assert
        mockMvc.perform(get("/api/pages/interfaces"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Device Interfaces"))
                .andExpect(jsonPath("$.data.interfaces").isArray())
                .andExpect(jsonPath("$.data.interfaces.length()").value(0));

        verify(webServerClient, times(1)).getAllInterfaces(any());
    }
}
